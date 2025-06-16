-- Create a new storage bucket for reports
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT (id) DO NOTHING;

-- Set up security policies for the reports bucket
CREATE POLICY "Employees can view their own reports"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'reports' AND
    (storage.foldername(name))[1] = 'signed_reports' AND
    position(auth.uid()::text in name) > 0
  );

CREATE POLICY "Supervisors can view reports for their employees"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'reports' AND
    (storage.foldername(name))[1] = 'signed_reports' AND
    EXISTS (
      SELECT 1
      FROM supervisor_profiles sp
      JOIN employee_profiles ep ON ep.work_centers && sp.work_centers
      WHERE sp.id = auth.uid()
        AND sp.is_active = true
        AND sp.supervisor_type = 'center'
        AND position(ep.id::text in name) > 0
    )
  );