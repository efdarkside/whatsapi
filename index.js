require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { SessionsClient } = require('@google-cloud/dialogflow');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// CONFIGURAÇÃO DE MONITORAMENTO DE TOKEN
// =============================================
const TOKEN_EXPIRATION = process.env.WHATSAPP_TOKEN_EXPIRATION 
  ? new Date(process.env.WHATSAPP_TOKEN_EXPIRATION) 
  : null;

// Verificador diário de expiração
setInterval(() => {
  if (TOKEN_EXPIRATION && new Date() > TOKEN_EXPIRATION) {
    console.error('⏰ ALERTA CRÍTICO: Token do WhatsApp expirou!');
    // Adicione aqui notificações (email, Slack, etc)
  } else if (TOKEN_EXPIRATION) {
    const daysLeft = Math.floor((TOKEN_EXPIRATION - new Date()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 7) {
      console.warn(`⚠️ Token expira em ${daysLeft} dias`);
    }
  }
}, 24 * 60 * 60 * 1000); // Verifica a cada 24h

// =============================================
// CONFIGURAÇÃO DO DIALOGFLOW (MESMO CÓDIGO ANTERIOR)
// =============================================
const dialogflowClient = new SessionsClient({
  projectId: process.env.DIALOGFLOW_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
});

// =============================================
// FUNÇÃO ATUALIZADA PARA ENVIO NO WHATSAPP
// =============================================
async function sendWhatsAppMessage(recipient, message) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
  try {
    const startTime = Date.now();
    const response = await axios.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { body: message }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000
    });

    console.log(`📤 Mensagem enviada em ${Date.now() - startTime}ms`);
    return response.data;

  } catch (error) {
    // Tratamento específico para token expirado
    if (error.response?.data?.error?.code === 190) {
      const errorData = error.response.data.error;
      console.error('🔴 ERRO DE TOKEN EXPIRADO:', {
        message: errorData.message,
        expiry: errorData.error_data?.expiry_date,
        fbtrace_id: errorData.fbtrace_id
      });
      
      throw new Error('TOKEN_EXPIRED'); // Erro especial para identificar o caso
    }

    // Outros erros
    console.error('🔴 ERRO NO WHATSAPP:', {
      status: error.response?.status,
      error: error.response?.data?.error || error.message,
      recipient,
      messagePreview: message?.substring(0, 50)
    });
    throw error;
  }
}

// =============================================
// ROTAS ATUALIZADAS COM TRATAMENTO DE TOKEN EXPIRADO
// =============================================
app.post('/webhook', async (req, res) => {
  try {
    const { entry } = req.body;
    const [firstEntry] = entry || [];
    const message = firstEntry?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const dialogflowResponse = await detectIntent(message.from, message.text?.body);
    
    try {
      await sendWhatsAppMessage(message.from, dialogflowResponse);
      res.status(200).json({ status: 'success' });
    } catch (sendError) {
      if (sendError.message === 'TOKEN_EXPIRED') {
        res.status(401).json({ 
          error: 'token_expired',
          message: 'O token do WhatsApp precisa ser renovado'
        });
      } else {
        throw sendError;
      }
    }

  } catch (error) {
    console.error('🔥 ERRO NO PROCESSAMENTO:', error.stack);
    res.status(500).json({ error: 'internal_error' });
  }
});

// =============================================
// DETECÇÃO DE INTENÇÃO (MESMA IMPLEMENTAÇÃO)
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
// INICIALIZAÇÃO COM VERIFICAÇÃO DE CONFIGURAÇÃO
// =============================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  
  // Verificações iniciais
  if (!process.env.WHATSAPP_ACCESS_TOKEN) {
    console.error('❌ WHATSAPP_ACCESS_TOKEN não definido');
  }
  
  if (TOKEN_EXPIRATION) {
    const daysLeft = Math.floor((TOKEN_EXPIRATION - new Date()) / (1000 * 60 * 60 * 24));
    console.log(`ℹ️ Token do WhatsApp expira em: ${daysLeft} dias`);
  }
});
