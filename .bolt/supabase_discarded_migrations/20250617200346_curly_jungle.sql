/*
  # Add signed reports table

  1. New Tables
    - `signed_reports` - Stores information about signed reports
      - `id` (uuid, primary key)
      - `employee_id` (uuid, references employee_profiles)
      - `report_url` (text)
      - `start_date` (date)
      - `end_date` (date)
      - `created_at` (timestamp with time zone)
      - `status` (text)
      - `recipient_emails` (text[])

  2. Security
    - Enable RLS on `signed_reports` table
    - Add policies for employees to view their own reports
    - Add policies for supervisors to view reports for employees they supervise
*/

-- Create signed_reports table
CREATE TABLE IF NOT EXISTS signed_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employee_profiles(id) ON DELETE CASCADE,
  report_url TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'viewed', 'archived')),
  recipient_emails TEXT[] DEFAULT '{}'
);

-- Enable RLS
ALTER TABLE signed_reports ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_signed_reports_employee_id ON signed_reports(employee_id);
CREATE INDEX IF NOT EXISTS idx_signed_reports_date_range ON signed_reports(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_signed_reports_status ON signed_reports(status);

-- Add RLS policies
-- Employees can view their own signed reports
CREATE POLICY "Employees can view their own signed reports"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (employee_id = auth.uid());

-- Supervisors can view reports for employees they supervise (center supervisors)
CREATE POLICY "Supervisors can view reports for employees they supervise (cent"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM supervisor_profiles sp
      JOIN employee_profiles ep ON ep.id = signed_reports.employee_id
      WHERE sp.id = auth.uid()
        AND sp.is_active = true
        AND sp.supervisor_type = 'center'
        AND ep.work_centers && sp.work_centers
    )
  );

-- Supervisors can view reports for employees they supervise (delegation supervisors)
CREATE POLICY "Supervisors can view reports for employees they supervise (dele"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM supervisor_profiles sp
      JOIN employee_profiles ep ON ep.id = signed_reports.employee_id
      WHERE sp.id = auth.uid()
        AND sp.is_active = true
        AND sp.supervisor_type = 'delegation'
        AND ep.delegation = ANY(sp.delegations)
    )
  );