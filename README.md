# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/4dfc7cb6-56df-45c4-8db6-b950144ddd13

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/4dfc7cb6-56df-45c4-8db6-b950144ddd13) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/4dfc7cb6-56df-45c4-8db6-b950144ddd13) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## 10/9/2025 next step:
Need ability to add an officer to another shift.  To add someone to a shift on the Daily Schedule that is not part of their recurring schedule.  Also need ability to change the time type for the Officers and Supervisors list as: Regular or Overtime, with default being Regular.

For Staff Profiles, I want Service Credit listed.

Need a way to view an individuals upcoming scheduled shifts.  When request PTO and approved, need to remove from scheduled shift and place at bottom of daily view for those shifts to reflect the PTO used.  The bottom of the daily view needs to load all schedueld PTO for that day for that shift.

For Daily Views: Assigned position "other" want excluded from minimum staff count.  This will be used for training/schools, light duty, etc.  Maybe separate "other" from the rest of the list at the bottom? Currently have "Other (PTO), make a section before this that is "Special Assignment" and change Other (PTO) to just PTO.  



"Work Schedule" is recurring schedule.  Add new work schedule refers to creating a new recurring schedule.  Still need ability to add officer to daily view from accepting a vacancy alert and manually from a supvervisor profile on the daily view schedule.

Daily View shift selector is not loading until you change the date.  Need shift selector to reload page after it is changed.

Had to use edge function in supabase to create new profiles:

Updated Edge Function Code
Replace your create-user function code with this:

typescript
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
How the Mapping Works:
Chief or Deputy Chief → admin role

Sergeant or Lieutenant → supervisor role

Officer (default) → officer role

The function is case-insensitive, so "chief", "Chief", "CHIEF" will all map to admin role.

Also Update Your Edit Functionality
You should also update the updateProfileMutation in your OfficerProfileDialog.tsx to handle role changes when editing an existing officer's rank. Add this after the profile update:

tsx
// In your updateProfileMutation, after the profile update succeeds:
const updateProfileMutation = useMutation({
  mutationFn: async (data: typeof formData) => {
    if (!officer?.id) throw new Error("No officer ID provided");
    
    // Update profile first
    const { error } = await supabase
      .from("profiles")
      .update({
        // ... your existing update fields
      })
      .eq("id", officer.id);

    if (error) throw error;

    // Update user role based on new rank
    const getRoleFromRank = (rank: string): string => {
      const rankLower = rank.toLowerCase();
      if (rankLower === 'chief' || rankLower === 'deputy chief') return 'admin';
      if (rankLower === 'sergeant' || rankLower === 'lieutenant') return 'supervisor';
      return 'officer';
    };

    const newRole = getRoleFromRank(data.rank);
    
    // Update the user_roles table
    const { error: roleError } = await supabase
      .from('user_roles')
      .update({ role: newRole })
      .eq('user_id', officer.id);

    if (roleError) {
      console.error('Failed to update role:', roleError);
      // Don't throw - the profile was updated successfully
    }
  },
  // ... rest of your mutation
});
Now when you create or edit profiles, the user roles will automatically be aligned with the rank hierarchy!

is this the code that needs to be updated?

  // Mutation for updating existing officer
  const updateProfileMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!officer?.id) throw new Error("No officer ID provided");
      
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: data.full_name,
          email: data.email,
          phone: data.phone || null,
          badge_number: data.badge_number || null,
          rank: data.rank as "Officer" | "Sergeant" | "Lieutenant" | "Deputy Chief" | "Chief",
          hire_date: hireDate ? format(hireDate, "yyyy-MM-dd") : null,
          service_credit_override: serviceCreditOverride ? Number(serviceCreditOverride) : null,
          vacation_hours: Number(data.vacation_hours) || 0,
          sick_hours: Number(data.sick_hours) || 0,
          comp_hours: Number(data.comp_hours) || 0,
          holiday_hours: Number(data.holiday_hours) || 0,
        })
        .eq("id", officer.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated successfully");
      queryClient.invalidateQueries({ queryKey: ["all-officers"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update profile");
    },
  });
Yes, that's exactly the code that needs to be updated! Here's the modified version with the role update logic added:

tsx
// Mutation for updating existing officer
const updateProfileMutation = useMutation({
  mutationFn: async (data: typeof formData) => {
    if (!officer?.id) throw new Error("No officer ID provided");
    
    // Update profile first
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: data.full_name,
        email: data.email,
        phone: data.phone || null,
        badge_number: data.badge_number || null,
        rank: data.rank as "Officer" | "Sergeant" | "Lieutenant" | "Deputy Chief" | "Chief",
        hire_date: hireDate ? format(hireDate, "yyyy-MM-dd") : null,
        service_credit_override: serviceCreditOverride ? Number(serviceCreditOverride) : null,
        vacation_hours: Number(data.vacation_hours) || 0,
        sick_hours: Number(data.sick_hours) || 0,
        comp_hours: Number(data.comp_hours) || 0,
        holiday_hours: Number(data.holiday_hours) || 0,
      })
      .eq("id", officer.id);

    if (error) throw error;

    // Update user role based on new rank
    const getRoleFromRank = (rank: string): string => {
      const rankLower = rank.toLowerCase();
      if (rankLower === 'chief' || rankLower === 'deputy chief') return 'admin';
      if (rankLower === 'sergeant' || rankLower === 'lieutenant') return 'supervisor';
      return 'officer';
    };

    const newRole = getRoleFromRank(data.rank);
    
    // Update the user_roles table
    const { error: roleError } = await supabase
      .from('user_roles')
      .update({ role: newRole })
      .eq('user_id', officer.id);

    if (roleError) {
      console.error('Failed to update role:', roleError);
      // Don't throw - the profile was updated successfully, just role update failed
    }
  },
  onSuccess: () => {
    toast.success("Profile updated successfully");
    queryClient.invalidateQueries({ queryKey: ["all-officers"] });
    onOpenChange(false);
  },
  onError: (error: any) => {
    toast.error(error.message || "Failed to update profile");
  },
});
Now when you edit an officer's profile and change their rank, their user role will automatically be updated to match:

Officer → officer role

Sergeant or Lieutenant → supervisor role

Deputy Chief or Chief → admin role

This ensures that both new profiles (created via the Edge Function) and existing profiles (edited via this dialog) maintain the proper role hierarchy based on rank.

## Current problems
The "end this schedule" button does not delete the future schedules.  I have to go into supabase and manually delete the recurring schedule to build a new one in the app.

## files function:

OfficerProfileDialog.tsx - Handles officer profile information (name, email, rank, PTO balances, etc.)

ScheduleManagementDialog.tsx - Simple dialog for creating recurring schedules

OfficerSchedulerManager.tsx - The main component you showed first, which has comprehensive schedule management

The key insight is that you want to add time-bound default assignments functionality to the OfficerSchedulerManager.tsx file, si
