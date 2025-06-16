import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LogOut, BarChart, Users, Clock, FileText, Settings, Shield } from 'lucide-react';
import CompanyEmployees from './CompanyEmployees';
import CompanyRequests from './CompanyRequests';
import CompanyCalendar from './CompanyCalendar';
import CompanyReports from './CompanyReports';
import CompanySettings from './CompanySettings';
import CompanyInspector from './CompanyInspector';
import { useCompany } from '../context/CompanyContext';

type TimeEntryType = 'turno' | 'coordinacion' | 'formacion' | 'sustitucion' | 'otros';

function CompanyOverview() {
  const { employees, timeEntries, loading, error, calculateEmployeeWorkTime, formatDuration } = useCompany();
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newEntry, setNewEntry] = useState({
    timestamp: '',
    entry_type: 'clock_in',
    time_type: 'turno' as TimeEntryType,
    work_center: null as string | null,
  });
  const [workCenters, setWorkCenters] = useState<string[]>([]);

  useEffect(() => {
    if (selectedEmployee) {
      const employee = employees.find(emp => emp.id === selectedEmployee);
      if (employee && employee.work_centers && employee.work_centers.length > 0) {
        setWorkCenters(employee.work_centers);
        setNewEntry(prev => ({
          ...prev,
          work_center: employee.work_centers[0] || null
        }));
      } else {
        setWorkCenters([]);
        setNewEntry(prev => ({
          ...prev,
          work_center: null
        }));
      }
    }
  }, [selectedEmployee, employees]);

  const handleAddEntry = async () => {
    try {
      if (!selectedEmployee) {
        throw new Error('Debe seleccionar un empleado');
      }

      if (!newEntry.work_center) {
        throw new Error('Debe seleccionar un centro de trabajo');
      }

      const entryDate = new Date(newEntry.timestamp).toISOString();

      if (newEntry.entry_type !== 'clock_in') {
        const { data: activeEntries, error: fetchError } = await supabase
          .from('time_entries')
          .select('*')
          .eq('employee_id', selectedEmployee)
          .eq('entry_type', 'clock_in')
          .eq('is_active', true)
          .lt('timestamp', entryDate)
          .order('timestamp', { ascending: false })
          .limit(1);

        if (fetchError) throw fetchError;
        if (!activeEntries || activeEntries.length === 0) {
          throw new Error('Debe existir una entrada activa antes de registrar una salida o pausa');
        }
      }

      const { error } = await supabase
        .from('time_entries')
        .insert([{
          employee_id: selectedEmployee,
          entry_type: newEntry.entry_type,
          time_type: newEntry.entry_type === 'clock_in' ? newEntry.time_type : null,
          timestamp: entryDate,
          changes: null,
          original_timestamp: null,
          is_active: true,
          work_center: newEntry.work_center,
        }]);

      if (error) throw error;

      setShowModal(false);
      setNewEntry({
        timestamp: '',
        entry_type: 'clock_in',
        time_type: 'turno',
        work_center: null,
      });
      setSelectedEmployee(null);

    } catch (err) {
      console.error('Error adding entry:', err);
      alert(err instanceof Error ? err.message : 'Error al añadir el fichaje');
    }
  };

  const getEntryTypeText = (type: string) => {
    switch (type) {
      case 'clock_in': return 'Entrada';
      case 'break_start': return 'Inicio Pausa';
      case 'break_end': return 'Fin Pausa';
      case 'clock_out': return 'Salida';
      default: return type;
    }
  };

  const getTimeTypeText = (type: TimeEntryType | null) => {
    switch (type) {
      case 'turno': return 'Fichaje de turno';
      case 'coordinacion': return 'Fichaje de coordinación';
      case 'formacion': return 'Fichaje de formación';
      case 'sustitucion': return 'Fichaje de horas de sustitución';
      case 'otros': return 'Otros';
      default: return '';
    }
  };

  const getEmployeeById = (id: string) => {
    return employees.find(emp => emp.id === id);
  };

  const getRecentTimeEntries = () => {
    return timeEntries
      .slice(0, 10)
      .map(entry => ({
        ...entry,
        employee: getEmployeeById(entry.employee_id)
      }));
  };

  const getTopEmployeesByHours = () => {
    return employees
      .map(employee => ({
        ...employee,
        totalTime: calculateEmployeeWorkTime(employee.id)
      }))
      .sort((a, b) => b.totalTime - a.totalTime)
      .slice(0, 5);
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Panel de Control</h1>
          <p className="text-gray-600">Bienvenido al sistema de gestión de tiempo</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-4">
              <Users className="w-8 h-8 text-blue-600" />
              <div>
                <p className="text-sm text-gray-600">Total Empleados</p>
                <p className="text-2xl font-bold">{employees.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-4">
              <Clock className="w-8 h-8 text-green-600" />
              <div>
                <p className="text-sm text-gray-600">Fichajes Hoy</p>
                <p className="text-2xl font-bold">
                  {timeEntries.filter(entry => {
                    const today = new Date().toISOString().split('T')[0];
                    return new Date(entry.timestamp).toISOString().split('T')[0] === today;
                  }).length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-4">
              <BarChart className="w-8 h-8 text-purple-600" />
              <div>
                <p className="text-sm text-gray-600">Solicitudes Pendientes</p>
                <p className="text-2xl font-bold">-</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Últimos Fichajes</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Empleado
                    </th>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tipo
                    </th>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Hora
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-4 text-center">
                        Cargando...
                      </td>
                    </tr>
                  ) : getRecentTimeEntries().length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-4 text-center">
                        No hay fichajes recientes
                      </td>
                    </tr>
                  ) : (
                    getRecentTimeEntries().map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {entry.employee?.fiscal_name || 'Empleado desconocido'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-900">
                            {getEntryTypeText(entry.entry_type)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Top Empleados por Horas</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Empleado
                    </th>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Horas Totales
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={2} className="px-6 py-4 text-center">
                        Cargando...
                      </td>
                    </tr>
                  ) : getTopEmployeesByHours().length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-6 py-4 text-center">
                        No hay datos disponibles
                      </td>
                    </tr>
                  ) : (
                    getTopEmployeesByHours().map((employee) => (
                      <tr key={employee.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {employee.fiscal_name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDuration(employee.totalTime)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm mb-8">
          <h2 className="text-lg font-semibold mb-4">Acciones Rápidas</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => setShowModal(true)}
              className="flex flex-col items-center justify-center gap-2 p-6 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <Clock className="w-8 h-8" />
              <span className="font-medium">Registrar Fichaje</span>
            </button>
            <Link
              to="/empresa/empleados"
              className="flex flex-col items-center justify-center gap-2 p-6 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
            >
              <Users className="w-8 h-8" />
              <span className="font-medium">Gestionar Empleados</span>
            </Link>
            <Link
              to="/empresa/solicitudes"
              className="flex flex-col items-center justify-center gap-2 p-6 bg-yellow-50 text-yellow-600 rounded-lg hover:bg-yellow-100 transition-colors"
            >
              <FileText className="w-8 h-8" />
              <span className="font-medium">Ver Solicitudes</span>
            </Link>
            <Link
              to="/empresa/informes"
              className="flex flex-col items-center justify-center gap-2 p-6 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors"
            >
              <BarChart className="w-8 h-8" />
              <span className="font-medium">Generar Informes</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Modal para añadir fichaje */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-semibold mb-4">Registrar Fichaje</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Empleado
                </label>
                <select
                  value={selectedEmployee || ''}
                  onChange={(e) => setSelectedEmployee(e.target.value || null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="">Seleccionar empleado</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fiscal_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha y Hora
                </label>
                <input
                  type="datetime-local"
                  value={newEntry.timestamp}
                  onChange={(e) => setNewEntry({ ...newEntry, timestamp: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de Fichaje
                </label>
                <select
                  value={newEntry.entry_type}
                  onChange={(e) => setNewEntry({ ...newEntry, entry_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="clock_in">Entrada</option>
                  <option value="break_start">Inicio Pausa</option>
                  <option value="break_end">Fin Pausa</option>
                  <option value="clock_out">Salida</option>
                </select>
              </div>

              {newEntry.entry_type === 'clock_in' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Entrada
                  </label>
                  <select
                    value={newEntry.time_type}
                    onChange={(e) => setNewEntry({ ...newEntry, time_type: e.target.value as TimeEntryType })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="turno">Fichaje de turno</option>
                    <option value="coordinacion">Fichaje de coordinación</option>
                    <option value="formacion">Fichaje de formación</option>
                    <option value="sustitucion">Fichaje de horas de sustitución</option>
                    <option value="otros">Otros</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Centro de Trabajo
                </label>
                {workCenters.length > 0 ? (
                  <select
                    value={newEntry.work_center || ''}
                    onChange={(e) => setNewEntry({ ...newEntry, work_center: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="">Seleccionar centro de trabajo</option>
                    {workCenters.map((center) => (
                      <option key={center} value={center}>
                        {center}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-red-500 text-sm">
                    El empleado no tiene centros de trabajo asignados
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAddEntry}
                  disabled={!selectedEmployee || !newEntry.timestamp || !newEntry.work_center}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  Registrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CompanyDashboard() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email || null);
    };
    getUser();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login/empresa');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <div className="flex items-center">
                <BarChart className="h-8 w-8 text-blue-600 mr-2" />
                <span className="text-xl font-bold text-gray-900">Portal Empresa</span>
              </div>
              <Link to="/empresa" className="text-gray-900 hover:text-gray-700 px-3 py-2 font-medium">
                Dashboard
              </Link>
              <Link to="/empresa/empleados" className="text-blue-600 hover:text-blue-700 px-3 py-2 font-medium">
                Empleados
              </Link>
              <Link to="/empresa/solicitudes" className="text-blue-600 hover:text-blue-700 px-3 py-2 font-medium">
                Solicitudes
              </Link>
              <Link to="/empresa/calendario" className="text-blue-600 hover:text-blue-700 px-3 py-2 font-medium">
                Calendario
              </Link>
              <Link to="/empresa/informes" className="text-blue-600 hover:text-blue-700 px-3 py-2 font-medium">
                Informes
              </Link>
              <Link to="/empresa/inspector" className="text-blue-600 hover:text-blue-700 px-3 py-2 font-medium">
                Inspector
              </Link>
              <Link to="/empresa/ajustes" className="text-blue-600 hover:text-blue-700 px-3 py-2 font-medium">
                Ajustes
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Users className="h-5 w-5 text-gray-500" />
                <span className="text-sm text-gray-600">{userEmail}</span>
              </div>
              <button 
                onClick={handleLogout}
                className="flex items-center text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg transition-colors duration-200"
              >
                <LogOut className="h-5 w-5 mr-2" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<CompanyOverview />} />
        <Route path="/empleados" element={<CompanyEmployees />} />
        <Route path="/solicitudes" element={<CompanyRequests />} />
        <Route path="/calendario" element={<CompanyCalendar />} />
        <Route path="/informes" element={<CompanyReports />} />
        <Route path="/inspector" element={<CompanyInspector />} />
        <Route path="/ajustes" element={<CompanySettings />} />
      </Routes>
    </div>
  );
}