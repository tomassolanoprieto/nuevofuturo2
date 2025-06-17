/*
  # Create signed_reports table

  1. New Tables
    - `signed_reports` - Stores information about signed reports
      - `id` (uuid, primary key)
      - `employee_id` (uuid, references employee_profiles)
      - `report_url` (text)
      - `start_date` (date)
      - `end_date` (date)
      - `created_at` (timestamptz)
      - `status` (text)
      - `recipient_emails` (text[])
  
  2. Security
    - Enable RLS on `signed_reports` table
    - Add policies for employees to view their own reports
    - Add policies for supervisors to view reports for employees they supervise
*/

-- Create signed_reports table if it doesn't exist
CREATE TABLE IF NOT EXISTS signed_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employee_profiles(id) ON DELETE CASCADE,
  report_url text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'viewed', 'archived')),
  recipient_emails text[] DEFAULT '{}'
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_signed_reports_employee_id ON signed_reports(employee_id);
CREATE INDEX IF NOT EXISTS idx_signed_reports_date_range ON signed_reports(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_signed_reports_status ON signed_reports(status);

-- Enable Row Level Security
ALTER TABLE signed_reports ENABLE ROW LEVEL SECURITY;

-- Employees can view their own signed reports
CREATE POLICY "Employees can view their own signed reports"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (employee_id = uid());

-- Supervisors can view reports for employees they supervise (center)
CREATE POLICY "Supervisors can view reports for employees they supervise (cent"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM supervisor_profiles sp
      JOIN employee_profiles ep ON ep.id = signed_reports.employee_id
      WHERE sp.id = uid()
        AND sp.is_active = true
        AND sp.supervisor_type = 'center'
        AND ep.work_centers && sp.work_centers
    )
  );

-- Supervisors can view reports for employees they supervise (delegation)
CREATE POLICY "Supervisors can view reports for employees they supervise (dele"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM supervisor_profiles sp
      JOIN employee_profiles ep ON ep.id = signed_reports.employee_id
      WHERE sp.id = uid()
        AND sp.is_active = true
        AND sp.supervisor_type = 'delegation'
        AND ep.delegation = ANY(sp.delegations)
    )
  );