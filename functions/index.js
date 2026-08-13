const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const cors = require("cors")({ origin: true });

const slackBotToken = defineSecret("SLACK_BOT_TOKEN");

function getSlackToken() {
  try {
    if (process.env.SLACK_BOT_TOKEN) return process.env.SLACK_BOT_TOKEN;
    const val = slackBotToken.value();
    if (val) return val;
  } catch (e) {
    // Secret is not available in local environment without params setup
  }
  return null;
}

/**
 * Validates webhook URLs to prevent Server-Side Request Forgery (SSRF).
 * Allows only secure HTTPS requests to trusted domains (Slack, Discord).
 */
function isValidWebhookUrl(webhookUrl) {
  if (typeof webhookUrl !== 'string' || !webhookUrl.trim()) {
    return false;
  }
  try {
    const parsed = new URL(webhookUrl);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();

    // Reject localhost and IP addresses (loopback, private, cloud metadata)
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname === '::1' ||
      hostname.startsWith('fe80:') ||
      hostname.startsWith('fc00:') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
    ) {
      return false;
    }

    const allowedDomains = [
      'hooks.slack.com',
      'discord.com',
      'discordapp.com'
    ];

    return allowedDomains.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch (err) {
    return false;
  }
}

/**
 * HTTP onRequest Endpoint: sendSlackMessage
 * Proxies messages to Slack Webhook / Slack API (chat.postMessage) or custom Webhook URLs (e.g. Discord).
 */
exports.sendSlackMessage = onRequest({ secrets: [slackBotToken] }, (req, res) => {
  return cors(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: "Method Not Allowed" });
    }

    const { channel, messagePayload, message, text, webhookUrl, payload } = req.body || {};
    const targetPayload = messagePayload || message || payload || text;

    // Webhook URL specified (Discord or custom Slack Webhook)
    if (webhookUrl) {
      if (!isValidWebhookUrl(webhookUrl)) {
        return res.status(400).json({ success: false, error: "Invalid or unauthorized webhook URL" });
      }
      try {
        const bodyContent = typeof targetPayload === 'string'
          ? { content: targetPayload, text: targetPayload }
          : (targetPayload || { text: "" });

        const fetchRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyContent)
        });

        if (!fetchRes.ok) {
          const errText = await fetchRes.text();
          return res.status(400).json({ success: false, error: `Webhook error: HTTP ${fetchRes.status}`, details: errText });
        }
        return res.json({ success: true, response: { ok: true } });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    if (!channel || !targetPayload) {
      return res.status(400).json({ success: false, error: "必要なパラメータが不足しています (channel, messagePayload)" });
    }

    try {
      const token = getSlackToken();
      if (!token) {
        return res.status(500).json({ success: false, error: "SLACK_BOT_TOKEN is not configured" });
      }
      const msgText = typeof targetPayload === 'string' ? targetPayload : (targetPayload.text || '');
      const msgBlocks = (typeof targetPayload === 'object' && targetPayload !== null) ? targetPayload.blocks : undefined;

      const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          channel: channel,
          text: msgText,
          blocks: msgBlocks
        })
      });

      const data = await slackRes.json();
      if (!data.ok) {
        return res.status(400).json({ success: false, error: data.error || 'Slack API error', response: data });
      }
      return res.json({ success: true, response: data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
});

/**
 * HTTP onRequest Endpoint: createSlackCanvas
 * Creates a Slack Canvas document and notifies the channel.
 */
exports.createSlackCanvas = onRequest({ secrets: [slackBotToken] }, (req, res) => {
  return cors(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: "Method Not Allowed" });
    }

    const { channel, channel_id, title, markdown, content } = req.body || {};
    const targetChannel = channel || channel_id;
    const targetMarkdown = markdown || content;

    if (!targetChannel || !title || !targetMarkdown) {
      return res.status(400).json({ success: false, error: "必要なパラメータが不足しています (channel, title, markdown)" });
    }

    try {
      const token = getSlackToken();
      if (!token) {
        return res.status(500).json({ success: false, error: "SLACK_BOT_TOKEN is not configured" });
      }

      // 1. Call Slack Canvas creation API
      const canvasRes = await fetch("https://slack.com/api/canvases.create", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          title: title,
          document_content: {
            type: "markdown",
            markdown: targetMarkdown
          },
          channel_id: targetChannel
        })
      });

      const parsed = await canvasRes.json();
      if (!parsed.ok) {
        return res.status(400).json({ success: false, error: parsed.error || 'Slack Canvas作成に失敗しました', response: parsed });
      }

      // 2. Send notification to the channel
      try {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8"
          },
          body: JSON.stringify({
            channel: targetChannel,
            text: `✨ 新しい会議キャンバス「${title}」を作成しました！\nチャンネル上部のタブから確認してください。`
          })
        });
      } catch (notifyErr) {
        console.warn("Canvas created but notification failed:", notifyErr);
      }

      return res.json({
        success: true,
        canvasId: parsed.canvas_id || (parsed.canvas && parsed.canvas.id),
        response: parsed
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
});

