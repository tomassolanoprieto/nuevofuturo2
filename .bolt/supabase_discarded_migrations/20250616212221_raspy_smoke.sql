/*
  # Create signed reports table

  1. New Tables
    - `signed_reports`
      - `id` (uuid, primary key)
      - `employee_id` (uuid, references employee_profiles)
      - `report_url` (text)
      - `start_date` (date)
      - `end_date` (date)
      - `created_at` (timestamp with time zone)
      - `status` (text)
  2. Security
    - Enable RLS on `signed_reports` table
    - Add policy for employees to view their own reports
    - Add policy for supervisors to view reports for their employees
*/

CREATE TABLE IF NOT EXISTS signed_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employee_profiles(id) ON DELETE CASCADE,
  report_url text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'generated',
  CONSTRAINT signed_reports_status_check CHECK (status IN ('generated', 'sent', 'viewed'))
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_signed_reports_employee_id ON signed_reports(employee_id);
CREATE INDEX IF NOT EXISTS idx_signed_reports_date_range ON signed_reports(start_date, end_date);

-- Enable RLS
ALTER TABLE signed_reports ENABLE ROW LEVEL SECURITY;

-- Employees can view their own reports
CREATE POLICY "Employees can view their own reports"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (employee_id = uid());

-- Supervisors can view reports for employees in their work centers
CREATE POLICY "Supervisors can view reports for their employees"
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

-- Create email_notifications table for tracking email notifications
CREATE TABLE IF NOT EXISTS email_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  report_url text,
  sent_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending',
  CONSTRAINT email_notifications_status_check CHECK (status IN ('pending', 'sent', 'failed'))
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_email_notifications_to_email ON email_notifications(to_email);
CREATE INDEX IF NOT EXISTS idx_email_notifications_status ON email_notifications(status);

-- Enable RLS
ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to view their own email notifications
CREATE POLICY "Users can view their own email notifications"
  ON email_notifications
  FOR SELECT
  TO authenticated
  USING (to_email = (SELECT email FROM employee_profiles WHERE id = uid()));