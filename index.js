const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// Rota para o webhook do Dialogflow
app.post('/webhook', async (req, res) => {
  const intent = req.body.queryResult.intent.displayName;
  const userMessage = req.body.queryResult.queryText;
  const phoneNumber = req.body.session.split('/').pop(); // Extrai o número do WhatsApp

  console.log(`Mensagem recebida de ${phoneNumber}: ${userMessage} (Intent: ${intent})`);

  // Simulação de envio para WhatsApp (substitua pela sua API real)
  const whatsappResponse = await sendToWhatsApp(phoneNumber, `Você disse: "${userMessage}". Intent detectada: ${intent}`);
  
  res.json({ fulfillmentText: `Mensagem enviada para WhatsApp: ${whatappResponse}` });
});

// Função simulada para enviar para a API do WhatsApp
async function sendToWhatsApp(phoneNumber, message) {
  // Substitua por sua lógica real (Twilio, WPP Cloud API, etc.)
  console.log(`Enviando para WhatsApp (${phoneNumber}): ${message}`);
  return "OK";
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
