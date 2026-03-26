// api/tweet.js
// Posts a Twitter/X thread using OAuth 1.0a (user context — required for writing tweets)

const crypto = require('crypto');

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g,  '%21')
    .replace(/'/g,  '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function buildOAuthHeader(method, url, consumerKey, consumerSecret, accessToken, accessTokenSecret) {
  const oauthParams = {
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
    oauth_token:            accessToken,
    oauth_version:          '1.0'
  };

  // For JSON-body requests the body is NOT included in the signature base string
  const paramString = Object.keys(oauthParams)
    .sort()
    .map(k => percentEncode(k) + '=' + percentEncode(oauthParams[k]))
    .join('&');

  const signatureBase =
    method.toUpperCase() + '&' +
    percentEncode(url) + '&' +
    percentEncode(paramString);

  const signingKey = percentEncode(consumerSecret) + '&' + percentEncode(accessTokenSecret);
  const signature  = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');

  const allParams  = { ...oauthParams, oauth_signature: signature };
  const headerStr  = 'OAuth ' + Object.keys(allParams)
    .sort()
    .map(k => percentEncode(k) + '="' + percentEncode(allParams[k]) + '"')
    .join(', ');

  return headerStr;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { consumerKey, consumerSecret, accessToken, accessTokenSecret, tweets } = req.body;

  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    return res.status(400).json({ error: 'Missing X API credentials' });
  }
  if (!tweets || !Array.isArray(tweets) || tweets.length === 0) {
    return res.status(400).json({ error: 'No tweets provided' });
  }

  const TWEET_URL = 'https://api.twitter.com/2/tweets';
  let lastTweetId  = null;
  const postedIds  = [];

  try {
    for (let i = 0; i < tweets.length; i++) {
      const text = tweets[i];
      if (!text || !text.trim()) continue;

      const body = { text: text.trim() };
      if (lastTweetId) {
        body.reply = { in_reply_to_tweet_id: lastTweetId };
      }

      const authHeader = buildOAuthHeader(
        'POST', TWEET_URL,
        consumerKey, consumerSecret,
        accessToken, accessTokenSecret
      );

      const response = await fetch(TWEET_URL, {
        method:  'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type':  'application/json',
          'User-Agent':    'TheDigest/1.0'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        const msg =
          data.detail ||
          data.title  ||
          (data.errors && data.errors[0] && data.errors[0].message) ||
          'Failed to post tweet ' + (i + 1);
        throw new Error(msg);
      }

      lastTweetId = data.data.id;
      postedIds.push(lastTweetId);

      // Small delay between tweets to avoid rate-limit spikes
      if (i < tweets.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    res.json({
      success:      true,
      ids:          postedIds,
      firstTweetId: postedIds[0],
      threadUrl:    'https://twitter.com/i/web/status/' + postedIds[0]
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
