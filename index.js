require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { SessionsClient } = require('@google-cloud/dialogflow');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// 1. CONFIGURAÇÃO INICIAL
// =============================================

// Configuração do Dialogflow
const dialogflowClient = new SessionsClient({
  projectId: process.env.DIALOGFLOW_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
});

// =============================================
// 2. MIDDLEWARES
// =============================================

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// =============================================
// 3. FUNÇÃO DE ENVIO PARA WHATSAPP (CORRIGIDA)
// =============================================

async function sendWhatsAppMessage(recipient, message) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
  try {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { 
        body: message,
        preview_url: false // Adicionado para evitar erros 400
      }
    };

    console.log('📤 Enviando para WhatsApp:', JSON.stringify(payload, null, 2));

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000
    });

    console.log('✅ Resposta do WhatsApp:', response.data);
    return response.data;

  } catch (error) {
    console.error('🔴 ERRO NA API DO WHATSAPP:', {
      status: error.response?.status,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        data: error.config?.data
      }
    });
    throw error;
  }
}

// =============================================
// 4. ROTA DO WEBHOOK (ATUALIZADA)
// =============================================

app.post('/webhook', async (req, res) => {
  try {
    // Verificação robusta do payload
    if (!req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      console.log('📭 Payload inválido:', req.rawBody);
      return res.status(200).end(); // Sempre retorne 200 para o WhatsApp
    }

    const message = req.body.entry[0].changes[0].value.messages[0];
    const sender = message.from;
    const messageText = message.text?.body;

    console.log(`📩 Mensagem recebida de ${sender}: ${messageText}`);

    // Processa no Dialogflow
    const dialogflowResponse = await detectIntent(sender, messageText || '');

    // Envia resposta
    await sendWhatsAppMessage(sender, dialogflowResponse);

    res.status(200).end();

  } catch (error) {
    console.error('🔥 ERRO NO PROCESSAMENTO:', {
      error: error.message,
      stack: error.stack,
      rawBody: req.rawBody
    });
    res.status(500).end();
  }
});

// =============================================
// 5. OUTRAS FUNÇÕES (MANTIDAS)
// =============================================

async function detectIntent(sessionId, messageText) {
  const sessionPath = dialogflowClient.projectAgentSessionPath(
    process.env.DIALOGFLOW_PROJECT_ID,
    sessionId
  );

  const [response] = await dialogflowClient.detectIntent({
    session: sessionPath,
    queryInput: {
      text: {
        text: messageText,
        languageCode: 'pt-BR',
      },
    },
  });

  return response.queryResult.fulfillmentText;
}

// =============================================
// 6. INICIALIZAÇÃO
// =============================================

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
