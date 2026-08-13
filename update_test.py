import re

with open('views.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Define the full function
func = '''async function testSlackWebhook() {
  const method = document.querySelector('input[name="slack-method"]:checked')?.value || 'webhook';
  const resultEl = document.getElementById('slack-test-result');
  resultEl.textContent = '送信中...';

  if (method === 'bot') {
    const channel = document.getElementById('setting-slack-channel')?.value?.trim();
    if (!channel) { resultEl.textContent = '❌ チャンネルを入力してください'; return; }
    try {
      const res = await API.sendSlackMessage(channel, { text: '✅ ViaGLYPH Botからのテスト送信です！' });
      if (res && res.success && res.response && res.response.ok) {
        resultEl.textContent = '✅ 送信しました（Slackを確認してください）';
        toast('✅ Slackテスト送信完了');
      } else {
        resultEl.textContent = '❌ 送信失敗: ' + (res?.response?.error || res?.error || '不明なエラー');
      }
    } catch (e) {
      resultEl.textContent = '❌ ネットワークエラー';
    }
    return;
  }
}'''

# Replace from 'async function testSlackWebhook() {' to the matching closing bracket
content = re.sub(r'async function testSlackWebhook\(\) \{.*?\n\}(?=\n|$)', func, content, flags=re.DOTALL)

with open('views.js', 'w', encoding='utf-8') as f:
    f.write(content)
