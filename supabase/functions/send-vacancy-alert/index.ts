import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { Resend } from "npm:resend@0.15.0"

const resend = new Resend(Deno.env.get('RESEND_API_KEY'))

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
@@ -14,78 +11,43 @@ serve(async (req) => {
  }

  try {
    // For now, let's just log and return success without actually sending emails
    const { to, subject, message, alertId } = await req.json()

    console.log('📧 WOULD SEND EMAIL (Resend API configured):')
    console.log('To:', to)
    console.log('Subject:', subject)
    console.log('Message:', message)
    console.log('Alert ID:', alertId)
    console.log('---')

    // Simulate success - remove this when ready to send real emails
    await new Promise(resolve => setTimeout(resolve, 100));


    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Email would be sent (Resend configured)',
        simulated: true

      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

    /* UNCOMMENT WHEN READY FOR REAL EMAILS:
    console.log('Sending real vacancy alert email to:', to)

    const { data, error } = await resend.emails.send({
      from: 'Shift Alerts <alerts@resend.dev>',
      to: [to],
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a56db;">🚨 Shift Vacancy Alert</h2>
          <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #1a56db;">
            ${message.replace(/\n/g, '<br>')}
          </div>
          <p style="color: #6b7280; font-size: 14px;">
            <strong>Action Required:</strong> Please log in to the scheduling system to sign up for this shift if you're available.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #9ca3af; font-size: 12px;">
            This is an automated message from your department's scheduling system. Please do not reply to this email.
          </p>
        </div>
      `
    })

    if (error) {
      console.error('Resend error:', error)
      throw error
    }

    console.log('Email sent successfully, message ID:', data?.id)

    return new Response(
      JSON.stringify({ success: true, messageId: data?.id }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
    */

  } catch (error) {
    console.error('Error in vacancy alert function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),




      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
