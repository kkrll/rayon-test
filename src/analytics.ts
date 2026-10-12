import posthog from 'posthog-js';

/**
 * Product analytics (PostHog). Configured from the environment, so the key
 * stays out of the repo; without VITE_POSTHOG_KEY every call is a no-op.
 *
 *   VITE_POSTHOG_KEY=phc_...                      (.env.local)
 *   VITE_POSTHOG_HOST=https://eu.i.posthog.com    (optional, defaults to US)
 */
const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const enabled = Boolean(key);

export function initAnalytics() {
  if (!enabled) return;
  posthog.init(key!, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com',
    // Projects live in the hash (#n97): count each switch as a pageview.
    capture_pageview: 'history_change',
    autocapture: true,
    person_profiles: 'always',
  });
  posthog.register({ layout: window.matchMedia('(max-width: 720px)').matches ? 'narrow' : 'wide' });
}

export type AnalyticsEvent =
  | 'project_opened'
  | 'history_viewed'
  | 'session_card_clicked'
  | 'filter_toggled'
  | 'copy_created'
  | 'reset_asked'
  | 'reset_cancelled'
  | 'reset_done'
  | 'debug_toggled';

export function track(event: AnalyticsEvent, props?: Record<string, unknown>) {
  if (enabled) posthog.capture(event, props);
}
