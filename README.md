# 🏋️ FastFit — Guía para subirla a internet e instalarla como app

Esta guía te lleva paso a paso. No necesitas instalar Node ni nada en tu computadora: **todo corre en internet**. Al final tendrás un ícono de FastFit en tu celular, como cualquier app.

Léela completa una vez antes de empezar. Tranquilo, es más fácil de lo que parece.

---

## 🎯 Resumen de lo que vas a hacer

1. Subir el proyecto a GitHub (un lugar gratis donde se guarda el código).
2. Conectar GitHub con Render (un servicio gratis que pone tu app online).
3. Pegar tu API key de Anthropic.
4. Instalar la app en tu celular con un ícono.

---

## PASO 1 — Crea una cuenta en GitHub

1. Entra a **https://github.com** y crea una cuenta gratis (si ya tienes, inicia sesión).

---

## PASO 2 — Sube el proyecto a GitHub

La forma más fácil, sin comandos:

1. En GitHub, arriba a la derecha, haz clic en el **+** → **New repository**.
2. Ponle un nombre, por ejemplo `fastfit`.
3. Déjalo en **Public** y haz clic en **Create repository**.
4. En la página que aparece, haz clic en el enlace **"uploading an existing file"** (subir un archivo existente).
5. **Descomprime** el `fastfit.zip` en tu computadora. Te queda una carpeta `fastfit` con archivos dentro.
6. **Arrastra TODO el contenido de la carpeta** (no la carpeta en sí, sino lo que está adentro: `src`, `server`, `public`, `package.json`, etc.) a la zona de GitHub.
7. Abajo, haz clic en **Commit changes**.

> ⚠️ Importante: NO subas ningún archivo `.env`. Tu API key va directo en Render, es más seguro.

---

## PASO 3 — Crea una cuenta en Render

1. Entra a **https://render.com** y regístrate gratis. Puedes entrar con tu cuenta de GitHub con un clic (botón "GitHub").

---

## PASO 4 — Pon tu app online

1. En Render, haz clic en **New** → **Web Service**.
2. Conecta tu GitHub y selecciona el repositorio `fastfit` que subiste.
3. Render leerá la configuración automáticamente (gracias al archivo `render.yaml`). Si te pide los datos a mano, usa esto:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Plan:** Free (gratis)
4. Antes de finalizar, busca la sección **Environment Variables** (o "Environment") y agrega:
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** pega aquí tu API key (la de console.anthropic.com, empieza con `sk-ant-...`)
   > 🔒 Aquí es donde va tu key. Render la guarda en secreto. Nadie la ve.
5. Haz clic en **Create Web Service**.
6. Espera unos minutos (verás cómo se construye). Cuando termine, Render te dará una dirección como:
   ```
   https://fastfit-xxxx.onrender.com
   ```
   ¡Esa es tu app online! Ábrela en el navegador.

---

## PASO 5 — Instala la app en tu celular (el ícono)

Ahora viene lo bueno. Abre la dirección de tu app en el celular y:

### En Android (Chrome):
1. Toca el menú **⋮** (arriba a la derecha).
2. Toca **"Instalar aplicación"** o **"Agregar a pantalla de inicio"**.
3. Confirma. ¡Listo! Aparece el ícono de FastFit en tu pantalla.

### En iPhone (Safari):
1. Toca el botón **compartir** (el cuadrado con la flecha hacia arriba, abajo en el centro).
2. Desliza y toca **"Agregar a pantalla de inicio"**.
3. Toca **Agregar**. ¡Listo! El ícono queda en tu pantalla.

Ahora abres FastFit como cualquier app, a pantalla completa, tocando su ícono. 🎉

---

## ❓ Problemas comunes

| Problema | Solución |
|---|---|
| La IA no responde | Revisa que pegaste bien la `ANTHROPIC_API_KEY` en Render y que tienes saldo en console.anthropic.com. |
| La app tarda en abrir la primera vez | El plan gratis de Render "se duerme" tras un rato sin uso. La primera carga puede tardar ~30 seg; luego va rápido. |
| No veo "Instalar aplicación" | Usa Chrome (Android) o Safari (iPhone), y entra a la dirección `https://...onrender.com`. |
| Cambié algo del código | Vuelve a subir los archivos a GitHub; Render actualiza la app solo. |

---

## 🔑 Sobre tu API key

- Tu key vive **solo en Render**, en secreto. Nunca está en el código ni en GitHub.
- Nunca la compartas ni la pegues en sitios desconocidos.
- Si crees que se filtró, ve a console.anthropic.com, bórrala y crea una nueva.

---

## 💡 Nota sobre internet

La app instalada **necesita internet para que la IA funcione** (rutinas, comidas, coach). Esto es normal: la inteligencia artificial vive en los servidores de Anthropic y tu app le pregunta por internet. El resto (ver tus datos, navegar) carga rápido porque se guarda en tu dispositivo.

---

¡Disfruta FastFit! 💪
