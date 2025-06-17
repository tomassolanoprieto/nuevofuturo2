import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@1.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  pdfBase64: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  reportStartDate: string;
  reportEndDate: string;
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

    // Initialize Resend email client
    const resend = new Resend(Deno.env.get('RESEND_API_KEY') ?? '');

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
    const { pdfBase64, employeeId, employeeName, employeeEmail, reportStartDate, reportEndDate } = body;

    if (!pdfBase64 || !employeeId || !employeeEmail || !reportStartDate || !reportEndDate) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Get employee's data including company_id
    const { data: employeeData, error: employeeError } = await supabaseAdmin
      .from('employee_profiles')
      .select('work_centers, company_id')
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

    // Get coordinator for the employee's work center
    const { data: coordinatorData, error: coordinatorError } = await supabaseAdmin
      .from('supervisor_profiles')
      .select('email')
      .eq('supervisor_type', 'center')
      .eq('is_active', true)
      .overlaps('work_centers', employeeData.work_centers)
      .limit(1);

    if (coordinatorError) {
      console.error('Error fetching coordinator data:', coordinatorError);
      // Continue even if we can't find a coordinator
    }

    const coordinatorEmail = coordinatorData && coordinatorData.length > 0 
      ? coordinatorData[0].email 
      : null;

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

    // Create signed_reports record
    const { data: reportRecord, error: reportError } = await supabaseAdmin
      .from('signed_reports')
      .insert({
        employee_id: employeeId,
        report_url: urlData.publicUrl,
        start_date: reportStartDate,
        end_date: reportEndDate,
        status: 'sent',
        company_id: employeeData.company_id
      })
      .select()
      .single();

    if (reportError) {
      console.error('Error creating report record:', reportError);
      return new Response(
        JSON.stringify({ error: 'Failed to create report record', details: reportError.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Create email recipients array
    const emailRecipients = [employeeEmail];
    if (coordinatorEmail) {
      emailRecipients.push(coordinatorEmail);
    }

    // Send email using Resend
    try {
      const { data: emailData, error: emailError } = await resend.emails.send({
        from: 'Nuevo Futuro <no-reply@nuevofuturo.org>',
        to: emailRecipients,
        subject: `Informe firmado del ${reportStartDate} al ${reportEndDate}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #2563eb; margin-bottom: 20px;">Informe de Jornada Laboral</h1>
            <p style="margin-bottom: 20px;">Hola,</p>
            <p style="margin-bottom: 20px;">Se ha generado un nuevo informe firmado para ${employeeName} correspondiente al período del ${reportStartDate} al ${reportEndDate}.</p>
            <p style="margin-bottom: 20px;">Puedes acceder al informe a través del siguiente enlace:</p>
            <p style="margin-bottom: 30px;">
              <a href="${urlData.publicUrl}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Ver Informe</a>
            </p>
            <p style="color: #666; font-size: 14px;">Este es un correo automático, por favor no responda a este mensaje.</p>
          </div>
        `,
      });

      if (emailError) {
        console.error('Email sending error:', emailError);
        // Continue even if email fails, we'll still update the database
      }

      // Update recipient_emails in the signed_reports table
      await supabaseAdmin
        .from('signed_reports')
        .update({ recipient_emails: emailRecipients })
        .eq('id', reportRecord.id);

    } catch (emailSendError) {
      console.error('Error sending email:', emailSendError);
      // Continue even if email fails, we'll still return success for the report creation
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Informe firmado enviado por correo electrónico',
        reportUrl: urlData.publicUrl,
        recipients: emailRecipients,
        reportId: reportRecord.id
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