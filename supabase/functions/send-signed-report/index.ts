import { createClient } from 'npm:@supabase/supabase-js@2';
import { send } from 'npm:emailjs-com@3.2.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  reportId: string;
  pdfBase64: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  reportStartDate: string;
  reportEndDate: string;
  signatureData: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role key (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const body: RequestBody = await req.json();
    const { 
      reportId, 
      pdfBase64, 
      employeeId, 
      employeeName, 
      employeeEmail, 
      reportStartDate, 
      reportEndDate,
      signatureData
    } = body;

    if (!pdfBase64 || !employeeId || !employeeEmail || !reportStartDate || !reportEndDate || !reportId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Get employee's supervisor email
    const { data: employeeData, error: employeeError } = await supabaseAdmin
      .from('employee_profiles')
      .select('work_centers, delegation')
      .eq('id', employeeId)
      .single();

    if (employeeError) {
      console.error('Error fetching employee data:', employeeError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch employee data', details: employeeError.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Get center supervisor for the employee's work center
    const { data: centerSupervisorData } = await supabaseAdmin
      .from('supervisor_profiles')
      .select('email')
      .eq('supervisor_type', 'center')
      .eq('is_active', true)
      .overlaps('work_centers', employeeData.work_centers)
      .limit(1);

    // Get delegation supervisor for the employee's delegation
    const { data: delegationSupervisorData } = await supabaseAdmin
      .from('supervisor_profiles')
      .select('email')
      .eq('supervisor_type', 'delegation')
      .eq('is_active', true)
      .contains('delegations', [employeeData.delegation])
      .limit(1);

    // Collect all supervisor emails
    const supervisorEmails: string[] = [];
    
    if (centerSupervisorData && centerSupervisorData.length > 0) {
      supervisorEmails.push(centerSupervisorData[0].email);
    }
    
    if (delegationSupervisorData && delegationSupervisorData.length > 0) {
      supervisorEmails.push(delegationSupervisorData[0].email);
    }

    // Convert base64 to blob
    const base64Data = pdfBase64.split(',')[1]; // Remove data:application/pdf;base64, prefix
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    // Upload PDF to Supabase Storage
    const filePath = `signed_reports/${employeeId}_${reportStartDate}_${reportEndDate}_${Date.now()}.pdf`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('reports')
      .upload(filePath, binaryData, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload PDF', details: uploadError.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Get public URL for the uploaded file
    const { data: urlData } = supabaseAdmin.storage
      .from('reports')
      .getPublicUrl(filePath);

    // Update the report record with the URL and recipient emails
    const { error: updateError } = await supabaseAdmin
      .from('signed_reports')
      .update({ 
        report_url: urlData.publicUrl,
        recipient_emails: [employeeEmail, ...supervisorEmails]
      })
      .eq('id', reportId);

    if (updateError) {
      console.error('Error updating report record:', updateError);
      // Continue anyway to try sending the email
    }

    // Send emails using EmailJS
    const emailJsResult = await send(
      'service_otiqowa',
      'template_8bsjbnl',
      {
        to_email: employeeEmail,
        cc_email: supervisorEmails.join(','),
        employee_name: employeeName,
        report_start_date: new Date(reportStartDate).toLocaleDateString('es-ES'),
        report_end_date: new Date(reportEndDate).toLocaleDateString('es-ES'),
        report_url: urlData.publicUrl
      },
      'KxnX0MtAANy2LPlwd'
    );

    console.log('EmailJS response:', emailJsResult);

    // Also create email notification records for tracking
    for (const recipient of [employeeEmail, ...supervisorEmails]) {
      const { error: emailError } = await supabaseAdmin
        .from('email_notifications')
        .insert({
          to_email: recipient,
          subject: `Informe firmado del ${reportStartDate} al ${reportEndDate}`,
          message: `Se ha generado un nuevo informe firmado para ${employeeName}. Puedes descargarlo desde: ${urlData.publicUrl}`,
          report_url: urlData.publicUrl
        });

      if (emailError) {
        console.error(`Email notification error for ${recipient}:`, emailError);
        // Continue with other recipients even if one fails
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Informe firmado enviado por correo electrónico',
        reportUrl: urlData.publicUrl,
        recipients: [employeeEmail, ...supervisorEmails]
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});