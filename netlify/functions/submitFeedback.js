// netlify/functions/submitFeedback.js
//
// Saves agent feedback to Supabase, then notifies Mike/Ernest by email
// via a Google Apps Script webhook (same pattern used elsewhere in the
// ABS stack -- see Broker Connect Texas's GAS backend).
//
// Expects POST body: {
//   tool: "Duty Desk",
//   category: "bug" | "confusing" | "suggestion" | "other",
//   message: "...",
//   agentName: "" (optional),
//   agentEmail: "" (optional)
// }
// Returns: { success: true }

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://petfaclkzdudyvyhifaj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_H6IVVyBLqTTsub1zH_igSw_EqimRQ9Y';

// Set this in Netlify env vars once the Apps Script webhook is deployed.
// If not set, the function still saves to Supabase -- it just skips the
// email step, so feedback is never lost even if email setup lags behind.
const NOTIFY_WEBHOOK_URL = process.env.FEEDBACK_NOTIFY_WEBHOOK_URL;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { tool, category, message, agentName, agentEmail } = payload;

  if (!tool || !category || !message || !message.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Tool, category, and message are required' }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    const { data: saved, error: saveError } = await supabase.rpc('submit_feedback', {
      p_tool: tool,
      p_category: category,
      p_message: message,
      p_agent_name: agentName || null,
      p_agent_email: agentEmail || null,
    });

    if (saveError) {
      console.error('Could not save feedback:', saveError);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not save feedback: ' + saveError.message }) };
    }

    // Best-effort email notification -- a failure here should not block
    // the person's feedback from being saved, since Supabase already has it.
    if (NOTIFY_WEBHOOK_URL) {
      try {
        await fetch(NOTIFY_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tool, category, message,
            agentName: agentName || '(not provided)',
            agentEmail: agentEmail || '(not provided)',
            submittedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
          }),
        });
      } catch (notifyErr) {
        console.error('Notification webhook failed (feedback was still saved):', notifyErr);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('submitFeedback error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
