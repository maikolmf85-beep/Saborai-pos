import React from 'react';
import { ArrowLeft, ExternalLink, ShieldCheck, FileText } from 'lucide-react';
import { BrandLogo } from './BrandLogos';

type LegalDocument = 'privacy' | 'terms';

interface LegalPageProps {
  document: LegalDocument;
}

const effectiveDate = '22 de octubre de 2026';
const contactEmail = 'soporte@saborai.site';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mb-8">
    <h2 className="mb-3 text-xl font-black text-[#3b3733]">{title}</h2>
    <div className="space-y-3 text-sm leading-7 text-[#6b686d]">{children}</div>
  </section>
);

export const LegalPage: React.FC<LegalPageProps> = ({ document }) => {
  const isPrivacy = document === 'privacy';
  const title = isPrivacy ? 'Política de Privacidad' : 'Condiciones de Servicio';
  const Icon = isPrivacy ? ShieldCheck : FileText;

  return (
    <div className="min-h-screen bg-[#fcfeff] text-[#3b3733]">
      <header className="border-b border-[#a9b994]/25 bg-white/90 px-4 py-4 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <a href="/" aria-label="Volver al inicio de Saborai">
            <BrandLogo variant="full" size="sm" />
          </a>
          <a href="/" className="inline-flex items-center gap-2 rounded-full border border-[#a9b994]/50 px-4 py-2 text-xs font-bold text-[#588157] transition-colors hover:bg-[#f4f7f0]">
            <ArrowLeft className="h-4 w-4" /> Volver a Saborai
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="mb-10 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f4f7f0] text-[#588157]">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-[#588157]">Saborai POS</p>
            <h1 className="text-3xl font-black tracking-tight sm:text-5xl">{title}</h1>
            <p className="mt-3 text-sm text-[#8b878b]">Última actualización: {effectiveDate}</p>
          </div>
        </div>

        {isPrivacy ? (
          <>
            <Section title="1. Responsable y alcance">
              <p>Esta Política de Privacidad explica cómo Saborai POS recopila, utiliza, conserva y protege la información relacionada con su plataforma de punto de venta para restaurantes, su sitio web, sus aplicaciones y sus canales de soporte.</p>
              <p>Al utilizar Saborai, el responsable del restaurante debe asegurarse de contar con las autorizaciones necesarias para tratar los datos de sus empleados, clientes y proveedores.</p>
            </Section>
            <Section title="2. Información que podemos recopilar">
              <p>Podemos recopilar datos de cuenta y contacto, como nombre, correo electrónico, teléfono, nombre del restaurante, información de suscripción y datos necesarios para autenticación.</p>
              <p>La plataforma puede procesar configuraciones del restaurante, salones, mesas, comandas, productos, inventario, usuarios, turnos, reportes y datos necesarios para facturación electrónica. Los datos fiscales y de Hacienda se utilizan únicamente para las funciones que el restaurante activa.</p>
              <p>Si se utiliza el soporte de WhatsApp, recibimos el número de WhatsApp, el nombre público de la cuenta y el contenido de los mensajes enviados al número de soporte.</p>
              <p>También podemos recibir información técnica, como dirección IP, navegador, dispositivo, registros de errores y actividad necesaria para seguridad, diagnóstico y funcionamiento del servicio.</p>
            </Section>
            <Section title="3. Cómo utilizamos la información">
              <p>Utilizamos la información para proporcionar y mantener Saborai POS, autenticar usuarios, guardar la configuración de cada restaurante, procesar comandas, generar reportes, operar integraciones autorizadas y brindar soporte.</p>
              <p>Nyza, el asistente de inteligencia artificial, puede procesar preguntas, contexto operativo limitado y mensajes de soporte para generar respuestas. Nyza no debe recibir contraseñas, tokens, claves de Hacienda, datos completos de tarjetas ni información sensible innecesaria.</p>
              <p>También utilizamos información técnica para prevenir fraude, investigar incidentes, mejorar la seguridad y cumplir obligaciones legales.</p>
            </Section>
            <Section title="4. Proveedores y transferencias">
              <p>Para operar algunas funciones podemos utilizar proveedores tecnológicos, incluyendo Supabase para almacenamiento y autenticación, Vercel para alojamiento, Meta para WhatsApp Cloud API y Google para los servicios de Gemini. Cada proveedor procesa información conforme a sus propios términos y políticas.</p>
              <p>No vendemos los datos personales de los usuarios. Solo compartimos información con proveedores necesarios para prestar una función solicitada, cumplir una obligación legal o proteger la seguridad del servicio.</p>
            </Section>
            <Section title="5. Conservación y seguridad">
              <p>Conservamos la información mientras exista una cuenta activa, una relación de servicio o una obligación legal que requiera mantenerla. El restaurante puede solicitar la eliminación de datos, sujeto a respaldos, obligaciones fiscales y requisitos legales.</p>
              <p>Aplicamos controles de acceso, aislamiento por restaurante, conexiones cifradas y protección de secretos. Ningún sistema conectado a Internet puede garantizar seguridad absoluta, por lo que recomendamos utilizar contraseñas únicas y no compartir credenciales.</p>
            </Section>
            <Section title="6. Derechos y contacto">
              <p>El titular puede solicitar acceso, corrección, actualización o eliminación de sus datos, así como información sobre el tratamiento realizado. Para gestionar una solicitud, escribe a <a className="font-bold text-[#588157] underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
              <p>Responderemos las solicitudes dentro de un plazo razonable y podremos pedir información para verificar la identidad del solicitante.</p>
            </Section>
            <Section title="7. Cambios a esta política">
              <p>Podemos actualizar esta política cuando cambien el servicio, las integraciones o los requisitos legales. Publicaremos la versión vigente en esta URL e indicaremos la fecha de actualización.</p>
            </Section>
          </>
        ) : (
          <>
            <Section title="1. Aceptación">
              <p>Estas Condiciones de Servicio regulan el acceso y uso de Saborai POS. Al crear una cuenta, iniciar una prueba o utilizar la plataforma, el usuario acepta estas condiciones en representación propia o del restaurante que administra.</p>
            </Section>
            <Section title="2. El servicio">
              <p>Saborai proporciona herramientas de punto de venta para restaurantes, incluyendo gestión de mesas, comandas, menú, inventario, turnos, reportes, facturación e integraciones de soporte. Las funciones disponibles dependen del plan contratado y de la configuración del restaurante.</p>
              <p>El servicio puede incluir funciones de inteligencia artificial, como Nyza. Estas funciones generan sugerencias y orientación; no sustituyen la revisión del administrador, del contador, del responsable fiscal ni del personal del restaurante.</p>
            </Section>
            <Section title="3. Cuenta y responsabilidades del usuario">
              <p>El usuario debe proporcionar información correcta, proteger sus credenciales, controlar los permisos de su personal y revisar las operaciones realizadas en su cuenta.</p>
              <p>El usuario no debe utilizar Saborai para actividades ilícitas, intentar acceder a datos de otro restaurante, introducir malware, evadir límites del servicio, enviar spam ni compartir claves privadas en el chat de soporte o con Nyza.</p>
            </Section>
            <Section title="4. Datos del restaurante y aislamiento">
              <p>Cada cuenta de restaurante debe utilizar sus propios usuarios, credenciales y configuraciones. El usuario es responsable de verificar que los datos cargados pertenezcan al restaurante correcto y de cerrar las sesiones en dispositivos compartidos.</p>
              <p>Saborai implementa medidas técnicas para separar la información entre restaurantes, pero el administrador debe revisar periódicamente usuarios, permisos, salones, mesas, turnos y operaciones.</p>
            </Section>
            <Section title="5. Suscripciones, prueba y pagos">
              <p>Las pruebas, planes, precios, límites y fechas de renovación se muestran en la pantalla de contratación o en la comunicación comercial correspondiente. Una prueba puede terminar o limitarse según las condiciones informadas al activarla.</p>
              <p>Los pagos se procesan mediante el proveedor de pagos habilitado. Saborai no solicita ni almacena números completos de tarjeta en sus canales de soporte.</p>
            </Section>
            <Section title="6. IA, facturación y responsabilidad operativa">
              <p>Las respuestas de Nyza pueden contener errores, estar incompletas o requerir verificación. El usuario debe confirmar antes de ejecutar cambios en el menú, inventario, comanda, caja o configuración fiscal.</p>
              <p>El restaurante sigue siendo responsable de la exactitud de precios, impuestos, códigos CABYS, comprobantes electrónicos, cierres de caja, datos de clientes y cumplimiento de sus obligaciones ante las autoridades.</p>
            </Section>
            <Section title="7. Disponibilidad y cambios">
              <p>Procuramos mantener Saborai disponible, pero pueden existir interrupciones por mantenimiento, proveedores externos, conectividad, límites de API, incidentes de seguridad o causas fuera de nuestro control. Podemos modificar, mejorar o retirar funciones con aviso razonable cuando sea posible.</p>
            </Section>
            <Section title="8. Propiedad intelectual y terminación">
              <p>Saborai, su software, marca, diseño y documentación pertenecen a sus respectivos titulares. El usuario conserva los derechos sobre los datos que carga y concede únicamente las autorizaciones necesarias para prestar el servicio.</p>
              <p>Podemos suspender o terminar una cuenta por incumplimiento, fraude, riesgo de seguridad o falta de pago. El usuario puede solicitar el cierre de su cuenta escribiendo a <a className="font-bold text-[#588157] underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
            </Section>
            <Section title="9. Ley aplicable y contacto">
              <p>Estas condiciones se interpretan conforme a las leyes aplicables de Costa Rica, sin perjuicio de los derechos irrenunciables que correspondan al consumidor. Para consultas sobre el servicio, escribe a <a className="font-bold text-[#588157] underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
            </Section>
          </>
        )}

        <div className="mt-12 flex flex-wrap gap-4 border-t border-[#a9b994]/25 pt-6 text-xs font-bold text-[#588157]">
          <a className="inline-flex items-center gap-1 hover:underline" href="/privacy-policy">Política de Privacidad <ExternalLink className="h-3.5 w-3.5" /></a>
          <a className="inline-flex items-center gap-1 hover:underline" href="/terms-of-service">Condiciones de Servicio <ExternalLink className="h-3.5 w-3.5" /></a>
        </div>
      </main>

      <footer className="border-t border-[#a9b994]/20 px-5 py-6 text-center text-xs text-[#8b878b]">
        Sistema diseñado por Maikol Matamoros · Saborai POS
      </footer>
    </div>
  );
};
