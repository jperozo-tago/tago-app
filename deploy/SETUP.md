# Desplegar el ecosistema TAGO en Firebase Hosting

Todo el ecosistema (Home + Calculadora 3D + Inventario) va en **un solo proyecto
Firebase llamado `tago`**, bajo el dominio **`tago.web.app`**, con las apps en rutas:

```
tago.web.app/            → Home (app madre)
tago.web.app/calculadora → Calculadora 3D
tago.web.app/inventario  → Control de Inventario
```

Al estar en el mismo dominio, comparten sesión → **inicias sesión una sola vez** en el Home.

---

## Etapa A — Dejarlo EN LÍNEA (Hosting)

> Estos pasos los hace José (o quien tenga la cuenta de Google del equipo).
> Yo (Claude) no puedo iniciar sesión con tu Google — ese paso es tuyo.

### 1. Iniciar sesión en Firebase (una sola vez, en tu Mac)
```bash
firebase login
```
Se abre el navegador → eliges tu cuenta de Google → "Permitir".
Con eso el CLI queda autorizado y ya no lo pides más.

### 2. Crear el proyecto `tago`
Opción por consola (recomendada): entra a https://console.firebase.google.com
→ "Agregar proyecto" → nómbralo **tago** (si el ID `tago` está tomado, Firebase te
sugiere uno; anótalo). Analytics es opcional.

*(O por CLI: `firebase projects:create tago` — si el ID está libre.)*

### 3. Desplegar
Desde la carpeta `deploy/`:
```bash
cd "App TAGO/deploy"
./deploy.sh
```
El script ensambla todo en `public/` y sube el Hosting. Al terminar te muestra:
**https://tago.web.app** 🎉

> Si el ID del proyecto no quedó exactamente `tago`, edita `.firebaserc` y pon el
> ID real, y en `deploy.sh` el mensaje final es solo informativo.

En este punto el ecosistema ya está **en línea y con login único**. Los usuarios y
PINs por defecto son: Miguel `1234`, Carol `2345`, José `3456`, Andreina `4567`
(cámbialos luego). Nota: en esta etapa la configuración y el historial se guardan
**por dispositivo** hasta terminar la Etapa B (Firestore).

---

## Etapa B — Datos compartidos entre todos (Cloud Firestore)

> Esta etapa la hacemos juntos: tú creas la base y habilitas el login anónimo (son
> clics en la consola que yo no puedo hacer por ti), y yo conecto el código y lo
> verifico en vivo.

### 1. Crear la base de datos Firestore
Consola → Build → **Firestore Database** → "Crear base de datos" → ubicación
`southamerica-east1` (São Paulo, la más cercana) → arranca en **modo producción**.

### 2. Habilitar Authentication anónima  ← (el único clic imprescindible)
Consola → Build → **Authentication** → "Comenzar" → pestaña "Sign-in method" →
habilita el proveedor **Anónimo**.
*(Esto permite que la app lea/escriba; el login real, con PIN, lo controla la app.)*

### 3. Registrar la app Web y copiar el `firebaseConfig`
Consola → ⚙ Configuración del proyecto → "Tus apps" → ícono `</>` (Web) → apodo
"TAGO Web" → copia el objeto `firebaseConfig`.
Me lo pasas y yo lo pego en el puente de Firebase de las apps.

### 4. Publicar las reglas de seguridad
Ya están en [`firestore.rules`](firestore.rules). Se publican con:
```bash
firebase deploy --only firestore:rules
```

### 5. Verificar en vivo
Abrimos `tago.web.app` desde dos dispositivos: un cambio de configuración o una
cotización en uno aparece en el otro en tiempo real; sin conexión avisa y sigue
funcionando (persistencia offline).

---

## Conectar tu dominio propio (cuando el ecosistema esté completo)
Consola → Hosting → "Agregar dominio personalizado" → `app.tago.cl` (o el que
elijan) → sigues las instrucciones de DNS. Las rutas (`/calculadora`, etc.) quedan
igual: no hay que cambiar nada del código.
