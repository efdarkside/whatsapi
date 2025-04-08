require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(bodyParser.json());

// Rota para verificação do webhook (Meta valida essa URL)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verificado com sucesso!');
    res.status(200).send(challenge);
  } else {
    console.error('Falha na verificação do webhook: token inválido');
    res.sendStatus(403);
  }
});

// Rota para receber mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  try {
    console.log('Recebido payload do WhatsApp:', JSON.stringify(req.body, null, 2));

    // Extrai dados da mensagem (estrutura do payload do WhatsApp)
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    
    if (!message) {
      console.log('Nenhuma mensagem válida encontrada no payload');
      return res.sendStatus(200); // Responde 200 para evitar retries
    }

    const senderPhone = message.from; // Número do remetente
    const messageText = message.text?.body; // Texto da mensagem

    // 1. Envia a mensagem para o Dialogflow
    const dialogflowResponse = await callDialogflow(messageText);

    // 2. Envia a resposta do Dialogflow de volta para o WhatsApp
    await sendToWhatsApp(senderPhone, dialogflowResponse);

    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).send('Erro interno');
  }
});

// Função para chamar o Dialogflow
async function callDialogflow(message) {
  const response = await axios.post(
    `https://dialogflow.googleapis.com/v2/projects/${process.env.DIALOGFLOW_PROJECT_ID}/agent/sessions/123456:detectIntent`,
    {
      queryInput: {
        text: {
          text: message,
          languageCode: 'pt-BR',
        },
      },
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.DIALOGFLOW_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.queryResult.fulfillmentText;
}

// Função para enviar mensagem ao WhatsApp
async function sendToWhatsApp(recipient, message) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: recipient,
      text: { body: message },
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
