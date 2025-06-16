/*
  # Add company_id column to signed_reports table

  1. Changes
    - Add `company_id` column to `signed_reports` table
    - Set up foreign key constraint to `company_profiles` table
    - Update existing records to have proper company_id values
    - Add index for better query performance

  2. Security
    - Update RLS policies to include company_id checks
*/

-- Add company_id column to signed_reports table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'signed_reports' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE signed_reports ADD COLUMN company_id uuid;
  END IF;
END $$;

-- Update existing records to set company_id based on employee's company
UPDATE signed_reports 
SET company_id = ep.company_id
FROM employee_profiles ep
WHERE signed_reports.employee_id = ep.id 
AND signed_reports.company_id IS NULL;

-- Add foreign key constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'signed_reports_company_id_fkey'
  ) THEN
    ALTER TABLE signed_reports 
    ADD CONSTRAINT signed_reports_company_id_fkey 
    FOREIGN KEY (company_id) REFERENCES company_profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_signed_reports_company_id 
ON signed_reports(company_id);

-- Update RLS policies to include company access
DROP POLICY IF EXISTS "Companies can view their signed reports" ON signed_reports;
CREATE POLICY "Companies can view their signed reports"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (company_id = uid());

DROP POLICY IF EXISTS "Companies can insert their signed reports" ON signed_reports;
CREATE POLICY "Companies can insert their signed reports"
  ON signed_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (company_id = uid());