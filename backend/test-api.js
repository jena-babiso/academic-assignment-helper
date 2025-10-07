const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testAPI() {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say 'API test successful!'" }],
      max_tokens: 10
    });
    console.log("✅ API Test Successful:", response.choices[0].message.content);
  } catch (error) {
    console.log("❌ API Error:", error.message);
  }
}

testAPI();