# Configurar Firebase para TAGO - Control de Inventario

Pasos a seguir en https://console.firebase.google.com para dejar el login funcionando.

## 1. Crear el proyecto
- Entra a la consola de Firebase y crea un proyecto nuevo, ej. `tago-inventario`.
- Google Analytics es opcional, puedes desactivarlo.

## 2. Agregar una app Web
- Dentro del proyecto: ⚙️ Configuración del proyecto → pestaña "General" → "Agregar app" → ícono `</>` (Web).
- Ponle un apodo, ej. "TAGO Inventario Web". No hace falta Firebase Hosting.
- Copia el objeto `firebaseConfig` que te muestra (algo como esto):

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "tago-inventario.firebaseapp.com",
  databaseURL: "https://tago-inventario-default-rtdb.firebaseio.com",
  projectId: "tago-inventario",
  storageBucket: "tago-inventario.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

- Pégalo en [index.html](index.html), reemplazando el bloque `firebaseConfig` que dice `TU_API_KEY`, etc. (buscá el comentario `TODO` cerca del final del archivo).

## 3. Habilitar Authentication anónima
- Menú lateral → Build → Authentication → "Comenzar".
- Pestaña "Sign-in method" → habilita el proveedor **Anónimo**.

Esto es lo que le permite a la app leer la base de datos sin pedirle contraseña a nadie — el login real (con PIN) lo controla la app, no Firebase Auth.

## 4. Crear la Realtime Database
- Menú lateral → Build → Realtime Database → "Crear base de datos".
- Elige la ubicación y arranca en modo **bloqueado** (locked mode).
- Ve a la pestaña "Reglas" y reemplaza el contenido por el de [firebase-setup/database.rules.json](firebase-setup/database.rules.json):

```json
{
  "rules": {
    "users": {
      ".read": "auth != null",
      ".write": false
    }
  }
}
```

- Publica los cambios.

## 5. Cargar los usuarios
- En la pestaña "Datos" de Realtime Database, en la raíz, usa el menú ⋮ → **Import JSON**.
- Sube el archivo [firebase-setup/users-seed.json](firebase-setup/users-seed.json) (importante: que quede en la raíz, creando el nodo `/users`).
- Este archivo trae PINs de ejemplo (1234, 2345, 3456, 4567). Edítalos ahí mismo en la consola por los PINs reales que quieran usar Miguel, Carol, José y Andreina.

## 6. Probar
- Guarda `index.html` con el `firebaseConfig` real pegado y ábrelo en el navegador.
- Deberías ver los 4 botones con los nombres, y poder entrar con el PIN de cada quien.

---

Para más adelante (no forma parte de esta etapa): si se necesita que los propios usuarios cambien su PIN desde la app, hay que ampliar las reglas de escritura y agregar una pantalla para eso.
