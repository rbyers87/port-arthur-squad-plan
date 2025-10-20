import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Function to map rank to user role
const getRoleFromRank = (rank: string): string => {
  const rankLower = rank.toLowerCase();
  
  if (rankLower === 'chief' || rankLower === 'deputy chief') {
    return 'admin';
  } else if (rankLower === 'sergeant' || rankLower === 'lieutenant') {
    return 'supervisor';
  } else {
    return 'officer';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { 
      email, 
      full_name, 
      phone, 
      badge_number, 
      rank, 
      hire_date, 
      service_credit_override,
      vacation_hours, 
      sick_hours, 
      comp_hours, 
      holiday_hours 
    } = await req.json()

    if (!email || !full_name) {
      throw new Error('Email and full name are required')
    }

    // Create admin client with service role key from secrets
    const supabaseAdmin = createClient(
      Deno.env.get('PROJECT_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Generate temporary password
    const tempPassword = `TempPass${Math.random().toString(36).slice(-8)}!`

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name }
    })

    if (authError) throw authError
    if (!authData.user) throw new Error('No user data returned')

    // Determine user role based on rank
    const userRole = getRoleFromRank(rank || 'Officer')
    const finalRank = rank || 'Officer'

    // Create profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authData.user.id,
        full_name,
        email,
        phone: phone || null,
        badge_number: badge_number || null,
        rank: finalRank,
        hire_date: hire_date || null,
        service_credit_override: service_credit_override ? Number(service_credit_override) : null,
        vacation_hours: Number(vacation_hours) || 0,
        sick_hours: Number(sick_hours) || 0,
        comp_hours: Number(comp_hours) || 0,
        holiday_hours: Number(holiday_hours) || 0,
      })

    if (profileError) {
      // Clean up auth user if profile fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      throw profileError
    }

    // Assign appropriate role in user_roles table based on rank
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: authData.user.id,
        role: userRole
      })

    if (roleError) {
      console.error('Role assignment error:', roleError)
      // Don't throw here - the user was created successfully, just role assignment failed
    }

    // Send password reset email
    const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email)

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: resetError 
          ? 'User created but password reset email failed' 
          : 'User created and password reset email sent',
        roleAssigned: !roleError,
        userRole: userRole,
        rank: finalRank
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
