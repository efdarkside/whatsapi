require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { SessionsClient } = require('@google-cloud/dialogflow');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// CONFIGURAÇÃO ANTIFRÁGIL DO DIALOGFLOW
// =============================================
const createDialogflowClient = () => {
  try {
    // Validação radical das variáveis
    if (!process.env.DIALOGFLOW_PROJECT_ID) {
      throw new Error('❌ DIALOGFLOW_PROJECT_ID não definido');
    }

    if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('❌ Credenciais do Google incompletas');
    }

    // DECODIFICAÇÃO À PROVA DE ERROS DA CHAVE PRIVADA
    const privateKey = process.env.GOOGLE_PRIVATE_KEY
      .replace(/\\n/g, '\n')  // Caso tenha \n literais
      .replace(/"/g, '')       // Remove aspas extras
      .trim();

    if (!privateKey.startsWith('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('❌ Formato inválido da chave privada');
    }

    console.log('🔑 Chave privada formatada corretamente');

    return new SessionsClient({
      projectId: process.env.DIALOGFLOW_PROJECT_ID,
      credentials: {
        type: 'service_account',
        project_id: process.env.DIALOGFLOW_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || '',
        private_key: privateKey,
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.GOOGLE_CLIENT_EMAIL)}`
      },
      apiEndpoint: 'dialogflow.googleapis.com',
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

  } catch (error) {
    console.error('💥 FALHA CRÍTICA NA CONFIGURAÇÃO:', error.message);
    console.log('ℹ️ Dicas para corrigir:');
    console.log('1. Verifique se GOOGLE_PRIVATE_KEY está em uma única linha');
    console.log('2. Confira se há \\n literais (não quebras de linha reais)');
    console.log('3. O projeto deve ter ativado a Dialogflow API');
    process.exit(1);
  }
};

const dialogflowClient = createDialogflowClient();

// =============================================
// MIDDLEWARES AVANÇADOS
// =============================================
app.use(express.json({
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      throw new Error('❌ JSON inválido');
    }
  }
}));

// =============================================
// ROTAS OTIMIZADAS
// =============================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ Webhook validado com sucesso');
    return res.status(200).send(challenge);
  }

  console.error('⚠️ Token de verificação inválido');
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    // Extração segura com destructuring
    const { entry } = req.body;
    const [firstEntry] = entry || [];
    const [firstChange] = firstEntry?.changes || [];
    const [firstMessage] = firstChange?.value?.messages || [];

    if (!firstMessage) {
      console.log('📭 Mensagem vazia recebida');
      return res.sendStatus(200);
    }

    const { from: sender, text, id: messageId } = firstMessage;
    const messageContent = text?.body;

    if (!messageContent) {
      console.log('✉️ Mensagem sem conteúdo textual');
      return res.sendStatus(200);
    }

    console.log(`📩 Mensagem recebida [${messageId}]: ${messageContent}`);

    // Processamento em cadeia com tratamento de erros
    const dialogflowResponse = await detectIntent(sender, messageContent);
    await sendWhatsAppMessage(sender, dialogflowResponse);

    res.status(200).json({ status: 'success' });

  } catch (error) {
    console.error('🔥 ERRO NO PROCESSAMENTO:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ 
      error: 'Erro interno',
      requestId: req.id
    });
  }
});

// =============================================
// FUNÇÕES PRINCIPAIS (COM RESILIÊNCIA)
// =============================================
async function detectIntent(sessionId, messageText) {
  const startTime = Date.now();
  
  try {
    console.log(`🔍 Detectando intenção para sessão: ${sessionId}`);
    
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

    const processingTime = Date.now() - startTime;
    console.log(`⚡ Resposta do Dialogflow em ${processingTime}ms`);

    return response.queryResult.fulfillmentText;

  } catch (error) {
    console.error('💀 ERRO NO DIALOGFLOW:', {
      errorCode: error.code,
      errorDetails: error.details || error.response?.data,
      sessionId,
      projectId: process.env.DIALOGFLOW_PROJECT_ID,
      credentials: {
        clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
        keyPreview: process.env.GOOGLE_PRIVATE_KEY?.substring(0, 30) + '...'
      }
    });

    throw new Error('Não foi possível processar sua mensagem no momento');
  }
}

async function sendWhatsAppMessage(recipient, message) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
  try {
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
      timeout: 10000 // 10 segundos de timeout
    });

    console.log('📤 Resposta enviada com sucesso:', response.data.id);

  } catch (error) {
    console.error('📛 ERRO NO WHATSAPP:', {
      status: error.response?.status,
      error: error.response?.data?.error || error.message,
      recipient,
      messagePreview: message?.substring(0, 50) + (message?.length > 50 ? '...' : '')
    });

    throw new Error('Falha ao enviar resposta');
  }
}

// =============================================
// INICIALIZAÇÃO ROBUSTA
// =============================================
app.listen(PORT, () => {
  console.log(`
  🚀 Servidor operacional na porta ${PORT}
  ⏱️ ${new Date().toLocaleString()}
  
  📌 Configurações carregadas:
     - Projeto Dialogflow: ${process.env.DIALOGFLOW_PROJECT_ID}
     - Número WhatsApp: ${process.env.WHATSAPP_PHONE_NUMBER_ID}
     - Ambiente: ${process.env.NODE_ENV || 'development'}
  `);
});

// Armadilha para erros não tratados
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Erro não tratado:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Falha catastrófica:', error);
  process.exit(1);
});
