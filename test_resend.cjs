require('dotenv').config({ path: 'c:/Users/matam/.gemini/antigravity-ide/scratch/saborai-pos/.env' });
const { Resend } = require('resend');

const resendApiKey = process.env.RESEND_API_KEY;
const resend = new Resend(resendApiKey);

async function testEmail() {
  try {
    const data = await resend.emails.send({
      from: "soporte@saborai.site",
      to: "matamoros.maikol85@gmail.com",
      subject: "Prueba desde script - Recuperación de contraseña",
      html: "<p>Este es un correo de prueba de Saborai POS.</p>"
    });
    console.log("Response:", data);
  } catch (error) {
    console.error("Error:", error);
  }
}

testEmail();
