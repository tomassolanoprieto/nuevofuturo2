import { createClient } from 'npm:@supabase/supabase-js@2';

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

    // Get employee's coordinator email
    const { data: employeeData, error: employeeError } = await supabaseAdmin
      .from('employee_profiles')
      .select('work_centers')
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

    // Create email recipients array
    const emailRecipients = [employeeEmail];
    if (coordinatorEmail) {
      emailRecipients.push(coordinatorEmail);
    }

    // Insert email notification records for each recipient
    for (const recipient of emailRecipients) {
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
        recipients: emailRecipients
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