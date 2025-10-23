import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const useNotificationsSubscription = (userId: string) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    // Subscribe to new notifications for this user
    const subscription = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `officer_id=eq.${userId}`
        },
        (payload) => {
          console.log('New notification received:', payload);
          // Invalidate notifications query to refresh the list
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          
          // Also show a toast notification
          import('sonner').then(({ toast }) => {
            toast.info(`New alert: ${payload.new.title}`, {
              description: payload.new.message,
              duration: 5000,
            });
          });
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [userId, queryClient]);
};
