import React, { useState, useEffect, useRef } from 'react'; 
import { supabase } from '../lib/supabase';
import { Calendar, Download, FileText, PenTool, X, Check } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { toast } from 'react-hot-toast';
import emailjs from '@emailjs/browser';

interface DailyReport {
  date: string;
  clock_in: string;
  clock_out: string;
  break_duration: string;
  total_hours: number;
}

interface SignatureData {
  x: number;
  y: number;
  time: number;
  pressure: number;
}

export default function EmployeeHistory() {
  const [entries, setEntries] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [totalTime, setTotalTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [employeeData, setEmployeeData] = useState<any>(null);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signature, setSignature] = useState<SignatureData[]>([]);
  const [isSigning, setIsSigning] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchTimeEntries();
    fetchEmployeeData();
  }, [startDate, endDate]);

  const fetchEmployeeData = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) return;

      const { data, error } = await supabase
        .from('employee_profiles')
        .select('*')
        .eq('id', employeeId)
        .single();

      if (error) throw error;
      if (data) setEmployeeData(data);
    } catch (err) {
      console.error('Error fetching employee data:', err);
    }
  };

  const fetchTimeEntries = async () => {
    try {
      setLoading(true);
      setError(null);

      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      let query = supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .order('timestamp', { ascending: true });

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query = query.gte('timestamp', start.toISOString());
      }
      
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query = query.lte('timestamp', end.toISOString());
      }

      const { data, error: entriesError } = await query;
      if (entriesError) throw entriesError;

      setEntries(data || []);
      calculateTotalTime(data);
    } catch (err) {
      console.error('Error fetching time entries:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar los fichajes');
    } finally {
      setLoading(false);
    }
  };

  const calculateTotalTime = (entries) => {
    if (!entries || entries.length === 0) {
      setTotalTime(0);
      return;
    }

    const employeeId = localStorage.getItem('employeeId');
    if (!employeeId) {
      setTotalTime(0);
      return;
    }

    const { dailyResults } = processTimeEntries(employeeId, entries);

    const totalMs = dailyResults.reduce((sum, day) => {
      if (day.hours) {
        return sum + (day.hours * 1000 * 60 * 60);
      }
      return sum;
    }, 0);

    setTotalTime(totalMs);
  };

  const processTimeEntries = (employeeId: string, timeEntries: any[]) => {
    const employeeEntries = timeEntries
      .filter(entry => entry.employee_id === employeeId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const dailyResults: any[] = [];
    let currentEntry: any = null;
    let pendingClockOuts: any[] = [];

    const getHoursWorked = (start: string, end: string, breakMs: number) => {
      const startTime = new Date(start).getTime();
      const endTime = new Date(end).getTime();
      return ((endTime - startTime) / (1000 * 60 * 60)) - (breakMs / (1000 * 60 * 60));
    };

    for (const entry of employeeEntries) {
      const dateKey = entry.timestamp.split('T')[0];
      const entryTime = new Date(entry.timestamp);

      switch (entry.entry_type) {
        case 'clock_in':
          if (currentEntry && currentEntry.clockIn && !currentEntry.clockOut) {
            const endOfDay = new Date(currentEntry.date);
            endOfDay.setHours(23, 59, 59, 999);
            currentEntry.clockOut = endOfDay.toISOString();
            currentEntry.hours = getHoursWorked(
              currentEntry.clockIn,
              currentEntry.clockOut,
              currentEntry.breakDuration
            );
            dailyResults.push(currentEntry);
          }
          
          currentEntry = {
            date: dateKey,
            dateObj: new Date(dateKey),
            clockIn: entry.timestamp,
            breakDuration: 0,
            clockOut: undefined,
            hours: 0
          };
          break;

        case 'clock_out':
          if (currentEntry && currentEntry.clockIn && !currentEntry.clockOut) {
            currentEntry.clockOut = entry.timestamp;
            currentEntry.hours = getHoursWorked(
              currentEntry.clockIn,
              currentEntry.clockOut,
              currentEntry.breakDuration
            );
            dailyResults.push(currentEntry);
            currentEntry = null;
          } else {
            pendingClockOuts.push(entry);
          }
          break;

        case 'break_start':
          if (currentEntry) {
            currentEntry.breakStart = entry.timestamp;
          }
          break;

        case 'break_end':
          if (currentEntry && currentEntry.breakStart) {
            const breakStart = new Date(currentEntry.breakStart).getTime();
            const breakEnd = entryTime.getTime();
            currentEntry.breakDuration += (breakEnd - breakStart);
            currentEntry.breakStart = undefined;
          }
          break;
      }
    }

    if (currentEntry && currentEntry.clockIn && !currentEntry.clockOut) {
      const endOfDay = new Date(currentEntry.date);
      endOfDay.setHours(23, 59, 59, 999);
      currentEntry.clockOut = endOfDay.toISOString();
      currentEntry.hours = getHoursWorked(
        currentEntry.clockIn,
        currentEntry.clockOut,
        currentEntry.breakDuration
      );
      dailyResults.push(currentEntry);
    }

    pendingClockOuts.forEach(clockOut => {
      dailyResults.push({
        date: clockOut.timestamp.split('T')[0],
        dateObj: new Date(clockOut.timestamp.split('T')[0]),
        clockIn: undefined,
        clockOut: clockOut.timestamp,
        breakDuration: 0,
        hours: 0
      });
    });

    const entriesByDate = employeeEntries.reduce((acc, entry) => {
      const date = entry.timestamp.split('T')[0];
      if (!acc[date]) acc[date] = [];
      acc[date].push(entry);
      return acc;
    }, {} as Record<string, any[]>);

    return {
      dailyResults,
      entriesByDate
    };
  };

  const filterToday = () => {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    setStartDate(dateStr);
    setEndDate(dateStr);
  };

  const filterWeek = () => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(monday.getDate() - monday.getDay() + (monday.getDay() === 0 ? -6 : 1));
    
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    
    setStartDate(monday.toISOString().split('T')[0]);
    setEndDate(sunday.toISOString().split('T')[0]);
  };

  const filterMonth = () => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    setStartDate(firstDay.toISOString().split('T')[0]);
    setEndDate(lastDay.toISOString().split('T')[0]);
  };

  const formatDuration = (ms) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const getEntryTypeText = (type) => {
    switch (type) {
      case 'clock_in': return 'Entrada';
      case 'break_start': return 'Inicio Pausa';
      case 'break_end': return 'Fin Pausa';
      case 'clock_out': return 'Salida';
      default: return type;
    }
  };

  const startSignature = (e: React.MouseEvent | React.TouchEvent) => {
    if (!signatureCanvasRef.current) return;
    
    const canvas = signatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    setIsSigning(true);
    
    let x, y;
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    
    setSignature([{ x, y, time: Date.now(), pressure: 0.5 }]);
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
    }
  };

  const drawSignature = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isSigning || !signatureCanvasRef.current) return;
    
    const canvas = signatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    
    let x, y;
    if ('touches' in e) {
      e.preventDefault();
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    
    const newPoint = { x, y, time: Date.now(), pressure: 0.5 };
    setSignature(prev => [...prev, newPoint]);
    
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const endSignature = () => {
    setIsSigning(false);
    if (signatureCanvasRef.current) {
      // Save the signature as data URL when finished
      setSignatureDataUrl(signatureCanvasRef.current.toDataURL('image/png'));
    }
  };

  const clearSignature = () => {
    setSignature([]);
    setSignatureDataUrl(null);
    if (signatureCanvasRef.current) {
      const ctx = signatureCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, signatureCanvasRef.current.width, signatureCanvasRef.current.height);
      }
    }
  };

  const saveSignature = () => {
    if (signature.length === 0) {
      toast.error('Por favor, firma antes de continuar');
      return;
    }
    setShowSignatureModal(false);
    generateSignedReport();
  };

  const sendEmailWithReport = async (pdfBlob: Blob) => {
    try {
      if (!employeeData) return;

      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(pdfBlob);
      
      return new Promise((resolve, reject) => {
        reader.onload = async () => {
          try {
            const base64Data = reader.result as string;
            
            // Create a record in signed_reports table
            const employeeId = localStorage.getItem('employeeId');
            
            // Create a signed report record
            const { data: reportData, error: reportError } = await supabase
              .from('signed_reports')
              .insert([{
                employee_id: employeeId,
                report_url: 'pending', // Will be updated by the edge function
                start_date: reportStartDate,
                end_date: reportEndDate,
                status: 'sent',
                recipient_emails: [employeeData.email]
              }])
              .select();
            
            if (reportError) {
              console.error('Error creating report record:', reportError);
              throw new Error('Failed to create report record');
            }
            
            // Use EmailJS to send the email with the PDF attachment
            const emailParams = {
              to_email: employeeData.email,
              from_name: 'Nuevo Futuro - Sistema de Control Horario',
              to_name: employeeData.fiscal_name,
              message: `Adjunto encontrarás el informe firmado del periodo ${reportStartDate} al ${reportEndDate}.`,
              report_pdf: base64Data,
              reply_to: 'noreply@nuevofuturo.org',
              start_date: reportStartDate,
              end_date: reportEndDate
            };
            
            const emailResult = await emailjs.send(
              'service_5z1qv9z', // Your EmailJS service ID
              'template_signed_report', // Your EmailJS template ID for reports with attachments
              emailParams,
              'YsQMH1h7gxb7yObr_' // Your EmailJS public key
            );
            
            if (emailResult.status !== 200) {
              throw new Error('Error al enviar el informe por correo');
            }
            
            // Update the report record with success status
            const { error: updateError } = await supabase
              .from('signed_reports')
              .update({ 
                status: 'viewed',
                report_url: 'sent_via_emailjs' // Mark as sent via EmailJS
              })
              .eq('id', reportData[0].id);
              
            if (updateError) {
              console.error('Error updating report status:', updateError);
              // Continue anyway since the email was sent
            }

            toast.success('Informe firmado enviado por correo electrónico');
            resolve(emailResult);
          } catch (err) {
            console.error('Error sending report:', err);
            toast.error('Error al enviar el informe por correo');
            reject(err);
          }
        };
        
        reader.onerror = () => {
          reject(new Error('Error al leer el archivo PDF'));
        };
      });
    } catch (err) {
      console.error('Error sending report:', err);
      toast.error('Error al enviar el informe por correo');
      throw err;
    }
  };

  const generateSignedReport = async () => {
    if (!reportStartDate || !reportEndDate) {
      toast.error('Por favor seleccione el rango de fechas para el informe');
      return;
    }

    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      if (!employeeData) {
        throw new Error('No se encontraron los datos del empleado');
      }

      // Obtener registros de tiempo
      const { data: timeEntries, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', new Date(reportStartDate).toISOString())
        .lte('timestamp', new Date(reportEndDate + 'T23:59:59.999Z').toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;

      // Procesar entradas
      const { dailyResults } = processTimeEntries(employeeId, timeEntries || []);

      // Crear array con todos los días en el rango
      const startDate = new Date(reportStartDate);
      const endDate = new Date(reportEndDate);
      const allDays: DailyReport[] = [];
      
      const resultsByDate: Record<string, any> = {};
      dailyResults.forEach(day => {
        const dateKey = day.dateObj.toISOString().split('T')[0];
        resultsByDate[dateKey] = day;
      });

      for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        const dateKey = date.toISOString().split('T')[0];
        const existingDay = resultsByDate[dateKey];
        
        if (existingDay) {
          allDays.push({
            date: existingDay.dateObj.toLocaleDateString('es-ES', {
              weekday: 'long',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            }),
            clock_in: existingDay.clockIn ? new Date(existingDay.clockIn).toLocaleTimeString('es-ES', { 
              hour: '2-digit', 
              minute: '2-digit' 
            }) : '',
            clock_out: existingDay.clockOut ? new Date(existingDay.clockOut).toLocaleTimeString('es-ES', { 
              hour: '2-digit', 
              minute: '2-digit' 
            }) : '',
            break_duration: existingDay.breakDuration > 0 ? 
              `${Math.floor(existingDay.breakDuration / (1000 * 60 * 60))}:${Math.floor((existingDay.breakDuration % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0')}` : '',
            total_hours: existingDay.hours || 0
          });
        } else {
          allDays.push({
            date: new Date(date).toLocaleDateString('es-ES', {
              weekday: 'long',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            }),
            clock_in: '',
            clock_out: '',
            break_duration: '',
            total_hours: 0
          });
        }
      }

      // Generar PDF
      const doc = new jsPDF();

      // Título
      doc.setFontSize(14);
      doc.text('Listado mensual del registro de jornada', 105, 20, { align: 'center' });

      // Información de la empresa y empleado
      doc.setFontSize(10);
      const tableData = [
        ['Empresa: NUEVO FUTURO', `Trabajador: ${employeeData.fiscal_name || ''}`],
        ['C.I.F/N.I.F: G28309862', `N.I.F: ${employeeData.document_number || ''}`],
        [`Centro de Trabajo: ${employeeData.work_centers?.join(', ') || ''}`],
        ['C.C.C:', `Mes y Año: ${new Date(reportStartDate).toLocaleDateString('es-ES', { month: '2-digit', year: 'numeric' })}`]
      ];

      doc.autoTable({
        startY: 30,
        head: [],
        body: tableData,
        theme: 'plain',
        styles: {
          cellPadding: 2,
          fontSize: 10
        },
        columnStyles: {
          0: { cellWidth: 95 },
          1: { cellWidth: 95 }
        }
      });

      // Registros diarios
      const recordsData = allDays.map(day => [
        day.date,
        day.clock_in,
        day.clock_out,
        day.break_duration,
        day.total_hours ? 
          `${Math.floor(day.total_hours)}:${Math.round((day.total_hours % 1) * 60).toString().padStart(2, '0')}` : 
          '0:00'
      ]);

      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 10,
        head: [['DIA', 'ENTRADA', 'SALIDA', 'PAUSAS', 'HORAS ORDINARIAS']],
        body: recordsData,
        theme: 'grid',
        styles: {
          cellPadding: 2,
          fontSize: 8,
          halign: 'center'
        },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 35 },
          4: { cellWidth: 35 }
        }
      });

      // Total horas
      const totalHours = allDays.reduce((acc, day) => acc + (day.total_hours || 0), 0);
      const hours = Math.floor(totalHours);
      const minutes = Math.round((totalHours % 1) * 60);
      const totalFormatted = `${hours}:${minutes.toString().padStart(2, '0')}`;

      doc.autoTable({
        startY: doc.lastAutoTable.finalY,
        head: [],
        body: [['TOTAL HORAS', '', '', '', totalFormatted]],
        theme: 'grid',
        styles: {
          cellPadding: 2,
          fontSize: 8,
          halign: 'center',
          fontStyle: 'bold'
        },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 35 },
          4: { cellWidth: 35 }
        }
      });

      // Firma del empleado (añadir imagen de la firma)
      if (signatureDataUrl) {
        doc.addImage(signatureDataUrl, 'PNG', 140, doc.lastAutoTable.finalY + 20, 50, 20);
      }

      // Firmas y lugar/fecha
      doc.setFontSize(10);
      doc.text('Firma de la Empresa:', 40, doc.lastAutoTable.finalY + 30);
      doc.text('Firma del Trabajador:', 140, doc.lastAutoTable.finalY + 30);

      doc.setFontSize(8);
      doc.text(`En Madrid, a ${new Date().toLocaleDateString('es-ES', { 
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })}`, 14, doc.lastAutoTable.finalY + 60);

      // Nota legal
      doc.setFontSize(6);
      const legalText = 'Registro realizado en cumplimiento del Real Decreto-ley 8/2019, de 8 de marzo, de medidas urgentes de protección social y de lucha contra la precariedad laboral en la jornada de trabajo ("BOE" núm. 61 de 12 de marzo), la regulación de forma expresa en el artículo 34 del texto refundido de la Ley del Estatuto de los Trabajadores (ET), la obligación de las empresas de registrar diariamente la jornada laboral.';
      doc.text(legalText, 14, doc.lastAutoTable.finalY + 70, {
        maxWidth: 180,
        align: 'justify'
      });

      // Guardar PDF y enviar por correo
      const pdfBlob = doc.output('blob');
      await sendEmailWithReport(pdfBlob);

      // Descargar también localmente
      doc.save(`informe_firmado_${employeeData.fiscal_name || 'empleado'}_${reportStartDate}_${reportEndDate}.pdf`);

    } catch (err) {
      console.error('Error generating signed report:', err);
      toast.error('Error al generar el informe firmado');
    }
  };

  const generateOfficialReport = async () => {
    if (!reportStartDate || !reportEndDate) {
      toast.error('Por favor seleccione el rango de fechas para el informe');
      return;
    }

    // Mostrar modal de confirmación antes de firmar
    toast(
      (t) => (
        <div className="flex flex-col items-center p-4">
          <p className="mb-4">¿Desea firmar y enviar el informe oficial?</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowSignatureModal(true);
                toast.dismiss(t.id);
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Firmar y Enviar
            </button>
            <button
              onClick={() => {
                generateUnsignedReport();
                toast.dismiss(t.id);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Solo Descargar
            </button>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
            >
              Cancelar
            </button>
          </div>
        </div>
      ),
      { duration: 10000 }
    );
  };

  const generateUnsignedReport = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      if (!employeeData) {
        throw new Error('No se encontraron los datos del empleado');
      }

      // Obtener registros de tiempo
      const { data: timeEntries, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', new Date(reportStartDate).toISOString())
        .lte('timestamp', new Date(reportEndDate + 'T23:59:59.999Z').toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;

      // Procesar entradas
      const { dailyResults } = processTimeEntries(employeeId, timeEntries || []);

      // Crear array con todos los días en el rango
      const startDate = new Date(reportStartDate);
      const endDate = new Date(reportEndDate);
      const allDays: DailyReport[] = [];
      
      const resultsByDate: Record<string, any> = {};
      dailyResults.forEach(day => {
        const dateKey = day.dateObj.toISOString().split('T')[0];
        resultsByDate[dateKey] = day;
      });

      for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        const dateKey = date.toISOString().split('T')[0];
        const existingDay = resultsByDate[dateKey];
        
        if (existingDay) {
          allDays.push({
            date: existingDay.dateObj.toLocaleDateString('es-ES', {
              weekday: 'long',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            }),
            clock_in: existingDay.clockIn ? new Date(existingDay.clockIn).toLocaleTimeString('es-ES', { 
              hour: '2-digit', 
              minute: '2-digit' 
            }) : '',
            clock_out: existingDay.clockOut ? new Date(existingDay.clockOut).toLocaleTimeString('es-ES', { 
              hour: '2-digit', 
              minute: '2-digit' 
            }) : '',
            break_duration: existingDay.breakDuration > 0 ? 
              `${Math.floor(existingDay.breakDuration / (1000 * 60 * 60))}:${Math.floor((existingDay.breakDuration % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0')}` : '',
            total_hours: existingDay.hours || 0
          });
        } else {
          allDays.push({
            date: new Date(date).toLocaleDateString('es-ES', {
              weekday: 'long',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            }),
            clock_in: '',
            clock_out: '',
            break_duration: '',
            total_hours: 0
          });
        }
      }

      // Generar PDF sin firma
      const doc = new jsPDF();

      // Título
      doc.setFontSize(14);
      doc.text('Listado mensual del registro de jornada', 105, 20, { align: 'center' });

      // Información de la empresa y empleado
      doc.setFontSize(10);
      const tableData = [
        ['Empresa: NUEVO FUTURO', `Trabajador: ${employeeData.fiscal_name || ''}`],
        ['C.I.F/N.I.F: G28309862', `N.I.F: ${employeeData.document_number || ''}`],
        [`Centro de Trabajo: ${employeeData.work_centers?.join(', ') || ''}`],
        ['C.C.C:', `Mes y Año: ${new Date(reportStartDate).toLocaleDateString('es-ES', { month: '2-digit', year: 'numeric' })}`]
      ];

      doc.autoTable({
        startY: 30,
        head: [],
        body: tableData,
        theme: 'plain',
        styles: {
          cellPadding: 2,
          fontSize: 10
        },
        columnStyles: {
          0: { cellWidth: 95 },
          1: { cellWidth: 95 }
        }
      });

      // Registros diarios
      const recordsData = allDays.map(day => [
        day.date,
        day.clock_in,
        day.clock_out,
        day.break_duration,
        day.total_hours ? 
          `${Math.floor(day.total_hours)}:${Math.round((day.total_hours % 1) * 60).toString().padStart(2, '0')}` : 
          '0:00'
      ]);

      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 10,
        head: [['DIA', 'ENTRADA', 'SALIDA', 'PAUSAS', 'HORAS ORDINARIAS']],
        body: recordsData,
        theme: 'grid',
        styles: {
          cellPadding: 2,
          fontSize: 8,
          halign: 'center'
        },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 35 },
          4: { cellWidth: 35 }
        }
      });

      // Total horas
      const totalHours = allDays.reduce((acc, day) => acc + (day.total_hours || 0), 0);
      const hours = Math.floor(totalHours);
      const minutes = Math.round((totalHours % 1) * 60);
      const totalFormatted = `${hours}:${minutes.toString().padStart(2, '0')}`;

      doc.autoTable({
        startY: doc.lastAutoTable.finalY,
        head: [],
        body: [['TOTAL HORAS', '', '', '', totalFormatted]],
        theme: 'grid',
        styles: {
          cellPadding: 2,
          fontSize: 8,
          halign: 'center',
          fontStyle: 'bold'
        },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 35 },
          4: { cellWidth: 35 }
        }
      });

      // Firmas
      doc.setFontSize(10);
      doc.text('Firma de la Empresa:', 40, doc.lastAutoTable.finalY + 30);
      doc.text('Firma del Trabajador:', 140, doc.lastAutoTable.finalY + 30);

      doc.setFontSize(8);
      doc.text(`En Madrid, a ${new Date().toLocaleDateString('es-ES', { 
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })}`, 14, doc.lastAutoTable.finalY + 60);

      // Nota legal
      doc.setFontSize(6);
      const legalText = 'Registro realizado en cumplimiento del Real Decreto-ley 8/2019, de 8 de marzo, de medidas urgentes de protección social y de lucha contra la precariedad laboral en la jornada de trabajo ("BOE" núm. 61 de 12 de marzo), la regulación de forma expresa en el artículo 34 del texto refundido de la Ley del Estatuto de los Trabajadores (ET), la obligación de las empresas de registrar diariamente la jornada laboral.';
      doc.text(legalText, 14, doc.lastAutoTable.finalY + 70, {
        maxWidth: 180,
        align: 'justify'
      });

      // Descargar localmente
      doc.save(`informe_oficial_${employeeData.fiscal_name || 'empleado'}_${reportStartDate}_${reportEndDate}.pdf`);

    } catch (err) {
      console.error('Error generating unsigned report:', err);
      toast.error('Error al generar el informe');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-6">Historial de Fichajes</h2>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
            {error}
          </div>
        )}
        
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex gap-2">
            <button
              onClick={filterToday}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Hoy
            </button>
            <button
              onClick={filterWeek}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Semana
            </button>
            <button
              onClick={filterMonth}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Mes
            </button>
          </div>
          <div className="flex gap-4 ml-auto">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha Inicio
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha Fin
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border rounded-lg px-3 py-2"
              />
            </div>
          </div>
        </div>

        <div className="bg-blue-50 p-6 rounded-lg mb-6">
          <h3 className="text-xl font-semibold mb-2">Tiempo Total Trabajado</h3>
          <p className="text-3xl font-bold text-blue-600">{formatDuration(totalTime)}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fecha
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Hora
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tipo
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Centro de Trabajo
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center">
                    Cargando fichajes...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center">
                    No hay fichajes para mostrar
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getEntryTypeText(entry.entry_type)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {entry.work_center || ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Sección de Informes */}
        <div className="mt-12 pt-8 border-t border-gray-200">
          <h2 className="text-2xl font-bold mb-6">Informes</h2>
          
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="text-blue-600" />
              <h3 className="text-lg font-semibold">Informe Oficial</h3>
            </div>
            
            <p className="text-gray-600 mb-6">
              Genera un informe oficial de tu jornada laboral para el período seleccionado.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha Inicio
                </label>
                <input
                  type="date"
                  value={reportStartDate}
                  onChange={(e) => setReportStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha Fin
                </label>
                <input
                  type="date"
                  value={reportEndDate}
                  onChange={(e) => setReportEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            
            <button
              onClick={generateOfficialReport}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download className="w-5 h-5" />
              Generar PDF
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Firma */}
      {showSignatureModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Firmar Informe</h3>
              <button 
                onClick={() => setShowSignatureModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <p className="mb-4 text-gray-600">
              Por favor, firma en el área de abajo con tu dedo o ratón.
            </p>
            
            <div className="border-2 border-dashed border-gray-300 rounded-lg mb-4">
              <canvas
                ref={signatureCanvasRef}
                width={500}
                height={200}
                className="w-full h-48 bg-gray-50 touch-none"
                onMouseDown={startSignature}
                onMouseMove={drawSignature}
                onMouseUp={endSignature}
                onMouseLeave={endSignature}
                onTouchStart={startSignature}
                onTouchMove={drawSignature}
                onTouchEnd={endSignature}
              />
            </div>
            
            <div className="flex justify-between">
              <button
                onClick={clearSignature}
                className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
              >
                <X className="w-5 h-5" />
                Limpiar
              </button>
              
              <button
                onClick={saveSignature}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                <Check className="w-5 h-5" />
                Confirmar Firma
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}