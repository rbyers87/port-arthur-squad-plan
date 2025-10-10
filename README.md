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

Add export function from daily view to be used as a riding list.  Export as pdf to print.

Add ability to add notes when assigning officer on daily view.  "court at 11:30" "working trade for Ofc Jones" "10-6 for training at 14:30" Make both PTO and Special Assigment have count but no minimum, *Other (PTO) already does this.

"Work Schedule" is recurring schedule.  Add new work schedule refers to creating a new recurring schedule.  Still need ability to add officer to daily view from accepting a vacancy alert and manually from a supvervisor profile on the daily view schedule.

Daily View shift selector is not loading until you change the date.  Need shift selector to reload page after it is changed.
