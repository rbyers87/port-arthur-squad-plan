import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, subject, message, alertId } = await req.json()

    console.log('📧 VACANCY ALERT SIMULATION (No Auth Required):')
    console.log('To:', to)
    console.log('Subject:', subject)
    console.log('Message:', message)
    console.log('Alert ID:', alertId)
    console.log('---')

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 50));

    // Always return success for simulation
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Email simulation successful',
        simulated: true,
        recipient: to
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in vacancy alert simulation:', error)
    return new Response(
      JSON.stringify({ 
        success: true, // Still return success even if there's an error for simulation
        simulated: true,
        error: error.message 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200, // Return 200 even for errors in simulation
      },
    )
  }
})
