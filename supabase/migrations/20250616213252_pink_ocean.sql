/*
  # Add signed reports table and related functionality

  1. New Tables
    - `signed_reports` - Stores records of signed reports
      - `id` (uuid, primary key)
      - `employee_id` (uuid, references employee_profiles)
      - `report_url` (text) - URL to the signed PDF
      - `start_date` (date) - Report start date
      - `end_date` (date) - Report end date
      - `created_at` (timestamp)
      - `status` (text) - Status of the report (sent, viewed, etc.)
      - `recipient_emails` (text[]) - List of emails the report was sent to
  
  2. Security
    - Enable RLS on `signed_reports` table
    - Add policies for employees to view their own reports
    - Add policies for supervisors to view reports for employees they supervise
  
  3. Email Notifications Table
    - `email_notifications` - Stores email notifications to be sent
      - `id` (uuid, primary key)
      - `to_email` (text)
      - `subject` (text)
      - `message` (text)
      - `report_url` (text)
      - `created_at` (timestamp)
      - `sent_at` (timestamp)
      - `status` (text)
*/

-- Create signed_reports table
CREATE TABLE IF NOT EXISTS signed_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employee_profiles(id) ON DELETE CASCADE,
  report_url text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'sent',
  recipient_emails text[] DEFAULT '{}'::text[],
  
  CONSTRAINT signed_reports_status_check CHECK (status IN ('sent', 'viewed', 'archived'))
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_signed_reports_employee_id ON signed_reports(employee_id);
CREATE INDEX IF NOT EXISTS idx_signed_reports_date_range ON signed_reports(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_signed_reports_status ON signed_reports(status);

-- Enable RLS on signed_reports
ALTER TABLE signed_reports ENABLE ROW LEVEL SECURITY;

-- Employees can view their own reports
CREATE POLICY "Employees can view their own signed reports"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (employee_id = uid());

-- Supervisors can view reports for employees they supervise (center)
CREATE POLICY "Supervisors can view reports for employees they supervise (center)"
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
CREATE POLICY "Supervisors can view reports for employees they supervise (delegation)"
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

-- Create email_notifications table
CREATE TABLE IF NOT EXISTS email_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  report_url text,
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  
  CONSTRAINT email_notifications_status_check CHECK (status IN ('pending', 'sent', 'failed'))
);

-- Create indexes for email_notifications
CREATE INDEX IF NOT EXISTS idx_email_notifications_status ON email_notifications(status);
CREATE INDEX IF NOT EXISTS idx_email_notifications_to_email ON email_notifications(to_email);

-- Enable RLS on email_notifications
ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;

-- Create storage bucket for reports if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT (id) DO NOTHING;

-- Create policy to allow public access to reports bucket
CREATE POLICY "Public Access to Reports"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'reports');