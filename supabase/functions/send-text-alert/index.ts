import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import twilio from "npm:twilio@4.19.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, message } = await req.json()

    console.log('Sending text alert to:', to)

    // For demo purposes, we'll just log the message
    // In production, you'd use Twilio or another SMS service
    console.log('Text message content:', message)
    
    // Example with Twilio (uncomment and configure when ready):
    /*
    const client = twilio(
      Deno.env.get('TWILIO_ACCOUNT_SID'),
      Deno.env.get('TWILIO_AUTH_TOKEN')
    )

    const result = await client.messages.create({
      body: message,
      from: Deno.env.get('TWILIO_PHONE_NUMBER'),
      to: to
    })
    */

    // For now, we'll simulate success
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Text alert simulated successfully',
        // messageId: result.sid // Uncomment when using Twilio
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error) {
    console.error('Error sending text alert:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
