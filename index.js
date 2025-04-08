require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { SessionsClient } = require('@google-cloud/dialogflow');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// CONFIGURAÇÕES INICIAIS
// =============================================

// Cache para evitar mensagens duplicadas
const processedMessages = new Set();

// Configuração do Dialogflow
const dialogflowClient = new SessionsClient({
  projectId: process.env.DIALOGFLOW_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
});

// =============================================
// MIDDLEWARES
// =============================================

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Middleware de logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// =============================================
// FUNÇÕES AUXILIARES
// =============================================

/**
 * Verifica se a mensagem já foi processada
 */
function isDuplicateMessage(messageId) {
  if (processedMessages.has(messageId)) {
    console.log('🔄 Mensagem duplicada ignorada:', messageId);
    return true;
  }
  
  // Limpa cache periodicamente para evitar memory leak
  if (processedMessages.size > 1000) {
    processedMessages.clear();
    console.log('🧹 Cache de mensagens limpo');
  }
  
  processedMessages.add(messageId);
  return false;
}

/**
 * Envia mensagem via WhatsApp API
 */
async function sendWhatsAppMessage(recipient, message) {
  try {
    const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: {
        body: message,
        preview_url: false
      }
    };

    console.log('✉️ Enviando mensagem para:', recipient);
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000
    });

    return response.data;

  } catch (error) {
    console.error('🔴 Erro ao enviar mensagem:', {
      status: error.response?.status,
      error: error.response?.data?.error || error.message
    });
    throw error;
  }
}

// =============================================
// ROTAS PRINCIPAIS
// =============================================

// Health Check para Keep-Alive
app.get('/health-check', (req, res) => {
  res.status(200).json({
    status: 'active',
    timestamp: new Date().toISOString(),
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// Verificação do Webhook
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    return res.status(200).send(challenge);
  }

  console.error('❌ Falha na verificação do webhook');
  res.sendStatus(403);
});

// Rota principal para mensagens
app.post('/webhook', async (req, res) => {
  try {
    const { entry } = req.body;
    const [firstEntry] = entry || [];
    const [firstChange] = firstEntry?.changes || [];
    
    // Verificação de payload inválido
    if (!firstChange?.value) {
      console.log('📭 Payload inválido recebido');
      return res.status(200).end();
    }

    // Processa mensagens textuais
    if (firstChange.value.messages) {
      const [message] = firstChange.value.messages;
      
      // Validações críticas
      if (!message || message.type !== 'text' || !message.text?.body) {
        console.log('⏭️ Mensagem não textual ignorada');
        return res.status(200).end();
      }

      // Controle de mensagens duplicadas
      if (isDuplicateMessage(message.id)) {
        return res.status(200).end();
      }

      console.log(`📩 Mensagem recebida [${message.id}]: ${message.text.body}`);

      // Comando especial para reset
      if (message.text.body.toLowerCase() === 'reset') {
        console.log('🔄 Reset de conversação solicitado');
        return res.status(200).end();
      }

      // Processa no Dialogflow
      const sessionPath = dialogflowClient.projectAgentSessionPath(
        process.env.DIALOGFLOW_PROJECT_ID,
        message.from
      );

      const [response] = await dialogflowClient.detectIntent({
        session: sessionPath,
        queryInput: {
          text: {
            text: message.text.body,
            languageCode: 'pt-BR',
          },
        },
      });

      // Envia resposta se houver conteúdo
      if (response.queryResult.fulfillmentText) {
        await sendWhatsAppMessage(message.from, response.queryResult.fulfillmentText);
      }
    }

    res.status(200).end();

  } catch (error) {
    console.error('🔥 Erro no processamento:', {
      error: error.message,
      stack: error.stack,
      body: req.rawBody
    });
    res.status(500).end();
  }
});

// =============================================
// INICIALIZAÇÃO E MANUTENÇÃO
// =============================================

// Keep-Alive para Render.com
const startKeepAlive = () => {
  const pingUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  setInterval(async () => {
    try {
      await axios.get(`${pingUrl}/health-check`, { timeout: 5000 });
      console.log('♻️ Keep-alive executado');
    } catch (error) {
      console.error('❌ Falha no keep-alive:', error.message);
    }
  }, 14 * 60 * 1000); // 14 minutos
};

const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  
  if (process.env.NODE_ENV === 'production') {
    startKeepAlive();
    console.log('⏲️ Keep-alive ativado');
  }
});

// Gerenciamento de erros
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Rejeição não tratada:', err);
});

process.on('uncaughtException', (err) => {
  console.error('💣 Exceção não capturada:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('🛑 Encerrando servidor...');
  server.close(() => {
    console.log('Servidor encerrado com sucesso');
    process.exit(0);
  });
});
