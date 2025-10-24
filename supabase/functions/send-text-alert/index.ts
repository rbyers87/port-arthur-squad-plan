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
    const { to, message } = await req.json()

    console.log('📱 TEXT ALERT SIMULATION:')
    console.log('To:', to)
    console.log('Message:', message)
    console.log('---')

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 50));

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Text simulation successful',
        simulated: true,
        recipient: to
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in text alert simulation:', error)
    return new Response(
      JSON.stringify({ 
        success: true, // Still return success for simulation
        simulated: true,
        error: error.message 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  }
})
