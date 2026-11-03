import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, TextInput, Alert, PanResponder } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import Paho from 'paho-mqtt';

// ================= CONFIGURACIÓN (el usuario no la ve) =================
const BROKER_HOST = '10.56.2.30';     // o la IP de tu compu si usás el puente
const ID_PASTILLERO = 'pastillero1';  // el mismo que en el ESP32
const BASE = `pastillero/${ID_PASTILLERO}/`;
const OPCIONES_WS = [
  { puerto: 9001, ruta: '/' },
  { puerto: 8083, ruta: '/mqtt' },
  { puerto: 8080, ruta: '/mqtt' },
  { puerto: 80,   ruta: '/mqtt' },
];

// Paho necesita localStorage, que no existe en el celular
const memoria = {};
global.localStorage = {
  setItem: (k, v) => { memoria[k] = v; },
  getItem: (k) => (k in memoria ? memoria[k] : null),
  removeItem: (k) => { delete memoria[k]; },
};

const N = 8, TAM = 220, C = TAM / 2, R = 100;
const GRADOS_SLOT = 360 / N;       // 45 grados por partición
const ACOMODAR_AL_SOLTAR = true;   // false = el círculo queda donde lo sueltes
const ESTADOS = {
  0: { texto: 'Vacía',      color: '#ffffff' },
  1: { texto: 'Pendiente',  color: '#fde68a' },
  2: { texto: 'Entregada',  color: '#86efac' },
  3: { texto: 'Omitida',    color: '#fca5a5' },
};

// Próxima vez que llega esa hora (hoy o mañana)
function proximaVez(h, m) {
  const ahora = new Date();
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d <= ahora) d.setDate(d.getDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

function formatear(t) {
  const d = new Date(t * 1000);
  const hoy = new Date();
  const manana = new Date();
  manana.setDate(hoy.getDate() + 1);
  const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === hoy.toDateString()) return 'hoy ' + hh;
  if (d.toDateString() === manana.toDateString()) return 'mañana ' + hh;
  return d.getDate() + '/' + (d.getMonth() + 1) + ' ' + hh;
}

// ================= Dibujo del carrusel =================
function Plato({ estados }) {
  const partes = [];
  for (let i = 0; i < N; i++) {
    const a1 = ((i * 360 / N - 180 / N - 90) * Math.PI) / 180;
    const a2 = ((i * 360 / N + 180 / N - 90) * Math.PI) / 180;
    const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
    const x2 = C + R * Math.cos(a2), y2 = C + R * Math.sin(a2);
    const color = i === 0 ? '#d1d5db' : ESTADOS[estados[i] || 0].color;
    partes.push(
      <Path key={'p' + i} d={`M${C},${C} L${x1},${y1} A${R},${R} 0 0,1 ${x2},${y2} Z`}
        fill={color} stroke="#555" strokeWidth={2} />
    );
    const am = ((i * 360 / N - 90) * Math.PI) / 180;
    partes.push(
      <SvgText key={'t' + i} x={C + 65 * Math.cos(am)} y={C + 65 * Math.sin(am) + 6}
        textAnchor="middle" fontSize="18" fontWeight="bold" fill="#222">{i}</SvgText>
    );
  }
  return <Svg width={TAM} height={TAM}>{partes}</Svg>;
}

// Carrusel que se gira con el dedo
function PlatoGiratorio({ estados, onTocando }) {
  const [angulo, setAngulo] = useState(0);
  const anguloRef = useRef(0);
  const ultimoToque = useRef(0);

  const anguloDelToque = (e) => {
    const x = e.nativeEvent.locationX - C;
    const y = e.nativeEvent.locationY - C;
    return (Math.atan2(y, x) * 180) / Math.PI;
  };

  const fijar = (a) => {
    anguloRef.current = a;
    setAngulo(a);
  };

  const soltar = () => {
    if (ACOMODAR_AL_SOLTAR) fijar(Math.round(anguloRef.current / GRADOS_SLOT) * GRADOS_SLOT);
    onTocando(false);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        onTocando(true);
        ultimoToque.current = anguloDelToque(e);
      },
      onPanResponderMove: (e) => {
        const a = anguloDelToque(e);
        let delta = a - ultimoToque.current;
        if (delta > 180) delta -= 360;     // cruzó el límite de -180/180
        if (delta < -180) delta += 360;
        ultimoToque.current = a;
        fijar(anguloRef.current + delta);
      },
      onPanResponderRelease: soltar,
      onPanResponderTerminate: soltar,
    })
  ).current;

  // Partición que quedó arriba, en la salida
  const enSalida = (((Math.round(-angulo / GRADOS_SLOT) % N) + N) % N);

  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 22, color: '#2563eb', lineHeight: 24 }}>▼</Text>
      <View style={{ width: TAM, height: TAM }} {...pan.panHandlers}>
        <View pointerEvents="none" style={{ transform: [{ rotate: angulo + 'deg' }] }}>
          <Plato estados={estados} />
        </View>
      </View>
      <Text style={{ marginTop: 6, color: '#555' }}>
        En la salida: partición {enSalida}{enSalida === 0 ? ' (inicio)' : ''}
      </Text>
    </View>
  );
}

function Boton({ titulo, onPress, deshabilitado, color }) {
  return (
    <TouchableOpacity
      style={[styles.boton, color && { backgroundColor: color }, deshabilitado && styles.botonOff]}
      onPress={onPress} disabled={deshabilitado}>
      <Text style={styles.botonTexto}>{titulo}</Text>
    </TouchableOpacity>
  );
}

// ================= App =================
export default function App() {
  const [conectado, setConectado] = useState(false);
  const [espOnline, setEspOnline] = useState(null);
  const [sinRed, setSinRed] = useState(false);
  const [estadoEsp, setEstadoEsp] = useState(null);
  const [aviso, setAviso] = useState({ texto: '', color: '#000' });
  const [log, setLog] = useState([]);
  const [verLog, setVerLog] = useState(false);
  const [scrollOn, setScrollOn] = useState(true);   // se apaga mientras se gira el círculo
  const [form, setForm] = useState(() => {
    const f = {};
    for (let s = 1; s < N; s++) f[s] = { h: '', m: '' };
    return f;
  });
  const [notas, setNotas] = useState({});   // texto libre de cada partición

  const clienteRef = useRef(null);
  const intento = useRef(0);
  const activo = useRef(true);
  const timer = useRef(null);
  const editado = useRef(false);
  const notasEditadas = useRef(false);

  const agregarLog = (t) =>
    setLog((prev) => [new Date().toLocaleTimeString() + '  ' + t, ...prev].slice(0, 50));

  const publicar = (cliente, sub, texto, retenido = false) => {
    const m = new Paho.Message(texto);
    m.destinationName = BASE + sub;
    m.retained = retenido;
    cliente.send(m);
    agregarLog('→ ' + sub + ': ' + texto);
  };

  // Completa el formulario con lo que tiene guardado el pastillero
  const llenarFormulario = (tomas) => {
    if (editado.current) return;
    const f = {};
    for (let s = 1; s < N; s++) f[s] = { h: '', m: '' };
    tomas.forEach((t) => {
      if (t.e === 1) {
        const d = new Date(t.t * 1000);
        f[t.slot] = { h: String(d.getHours()).padStart(2, '0'), m: String(d.getMinutes()).padStart(2, '0') };
      }
    });
    setForm(f);
  };

  const procesarMensaje = (topic, texto) => {
    const sub = topic.replace(BASE, '');
    if (sub === 'comando' || sub === 'horarios' || sub === 'hora') return;
    agregarLog('← ' + sub + ': ' + texto);

    if (sub === 'online') setEspOnline(texto === 'online');
    else if (sub === 'notas') {
      try {
        const n = JSON.parse(texto);
        if (!notasEditadas.current) setNotas(n);
      } catch (x) {}
    }
    else if (sub === 'estado') {
      try {
        const e = JSON.parse(texto);
        setEstadoEsp(e);
        llenarFormulario(e.tomas || []);
      } catch (x) {}
    } else if (sub === 'evento') {
      try {
        const e = JSON.parse(texto);
        if (e.evento === 'entrega') setAviso({ texto: `✅ Se entregó la pastilla de la partición ${e.slot}`, color: '#16a34a' });
        if (e.evento === 'omitida') setAviso({ texto: `⚠ Se omitió la partición ${e.slot}: pasaron más de 30 minutos`, color: '#dc2626' });
        if (e.evento === 'horarios_ok') setAviso({ texto: `💾 El pastillero guardó ${e.slot} horario(s)`, color: '#2563eb' });
        if (e.evento === 'inicio') setAviso({ texto: '⏮ Carrusel alineado', color: '#2563eb' });
        if (e.evento === 'alineado') setAviso({ texto: '✅ Alineado en la partición 0', color: '#16a34a' });
        if (e.evento === 'no_alineado') setAviso({ texto: '⚠ NO está alineado en la partición 0', color: '#dc2626' });
        if (e.evento === 'sin_sensor') setAviso({ texto: 'ℹ Sin sensor: no se puede verificar', color: '#d97706' });
        if (e.evento === 'moviendo') setAviso({ texto: '🔄 El carrusel se está moviendo', color: '#2563eb' });
        if (e.evento === 'alinear_fallo') setAviso({ texto: '⚠ No se encontró la partición 0. Revisá el sensor y el imán', color: '#dc2626' });
      } catch (x) {}
    }
  };

  const reintentar = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(conectar, 2000);
  };

  const conectar = () => {
    if (!activo.current) return;
    const op = OPCIONES_WS[intento.current % OPCIONES_WS.length];
    agregarLog(`Probando ${BROKER_HOST}:${op.puerto}${op.ruta}`);
    const cliente = new Paho.Client(BROKER_HOST, op.puerto, op.ruta,
      'app-' + Math.random().toString(16).slice(2, 8));

    cliente.onMessageArrived = (m) => procesarMensaje(m.destinationName, m.payloadString);
    cliente.onConnectionLost = (r) => {
      setConectado(false);
      setEspOnline(null);
      agregarLog('Conexión perdida: ' + r.errorMessage);
      reintentar();
    };

    cliente.connect({
      timeout: 4,
      useSSL: false,
      onSuccess: () => {
        setConectado(true);
        setSinRed(false);
        agregarLog(`✔ Conectado por el puerto ${op.puerto}`);
        cliente.subscribe(BASE + '#');
        // Le manda la hora del celular, por si el pastillero no tiene internet
        publicar(cliente, 'hora', String(Math.floor(Date.now() / 1000)));
        publicar(cliente, 'comando', 'estado');
      },
      onFailure: (e) => {
        agregarLog(`✘ Puerto ${op.puerto}: ${e.errorMessage}`);
        intento.current++;
        if (intento.current % OPCIONES_WS.length === 0) setSinRed(true);
        reintentar();
      },
    });
    clienteRef.current = cliente;
  };

  useEffect(() => {
    conectar();
    return () => {
      activo.current = false;
      clearTimeout(timer.current);
      try { clienteRef.current && clienteRef.current.disconnect(); } catch (e) {}
    };
  }, []);

  const cambiar = (s, campo, valor) => {
    editado.current = true;
    setForm((f) => ({ ...f, [s]: { ...f[s], [campo]: valor.replace(/[^0-9]/g, '') } }));
  };

  const cambiarNota = (s, valor) => {
    notasEditadas.current = true;
    setNotas((n) => ({ ...n, [s]: valor }));
  };

  const borrar = (s) => {
    editado.current = true;
    setForm((f) => ({ ...f, [s]: { h: '', m: '' } }));
  };

  const guardarHorarios = () => {
    // Las notas se guardan siempre (retenidas, para que no se pierdan al cerrar la app)
    publicar(clienteRef.current, 'notas', JSON.stringify(notas), true);
    notasEditadas.current = false;

    const tomas = [];
    for (let s = 1; s < N; s++) {
      const { h, m } = form[s];
      if (h === '' && m === '') continue;
      const hh = parseInt(h, 10);
      const mm = m === '' ? 0 : parseInt(m, 10);
      if (isNaN(hh) || hh > 23 || isNaN(mm) || mm > 59) {
        Alert.alert('Hora inválida', `Revisá la hora de la partición ${s}`);
        return;
      }
      tomas.push({ slot: s, t: proximaVez(hh, mm) });
    }
    // Retenido: si el pastillero está apagado, lo recibe al conectarse
    publicar(clienteRef.current, 'horarios', JSON.stringify({ id: Date.now(), tomas }), true);
    editado.current = false;
    setAviso({ texto: '📤 Horarios y notas enviados', color: '#2563eb' });
  };

  const comando = (cmd) => {
    if (conectado && clienteRef.current) publicar(clienteRef.current, 'comando', cmd);
  };

  // Estado de cada partición según el pastillero
  const tomasEsp = {};
  (estadoEsp?.tomas || []).forEach((t) => { tomasEsp[t.slot] = t; });
  const estadosPlato = {};
  for (let s = 1; s < N; s++) estadosPlato[s] = tomasEsp[s] ? tomasEsp[s].e : 0;

  let estadoTexto, estadoColor;
  if (conectado && espOnline) { estadoTexto = '🟢 Pastillero conectado'; estadoColor = '#16a34a'; }
  else if (conectado) { estadoTexto = '🟡 El pastillero está apagado o sin WiFi. Los horarios le llegan cuando se conecte.'; estadoColor = '#d97706'; }
  else if (sinRed) { estadoTexto = '🔴 Sin conexión. Revisá que el celular esté en el WiFi del pastillero'; estadoColor = '#dc2626'; }
  else { estadoTexto = '⏳ Conectando...'; estadoColor = '#555'; }

  return (
    <ScrollView style={styles.fondo} contentContainerStyle={{ padding: 16, paddingTop: 50 }}
      keyboardShouldPersistTaps="handled" scrollEnabled={scrollOn}>
      <Text style={styles.titulo}>💊 Mi Pastillero</Text>

      <View style={styles.card}>
        <Text style={{ fontSize: 16, fontWeight: 'bold', color: estadoColor }}>{estadoTexto}</Text>
        {estadoEsp && espOnline && !estadoEsp.hora_ok && (
          <Text style={styles.alerta}>⚠ El pastillero todavía no tiene la hora</Text>
        )}
        {estadoEsp && espOnline && !estadoEsp.posicion && (
          <Text style={styles.alerta}>⚠ Girá el carrusel a mano hasta que la partición 0 quede en la salida y tocá "Ya alineé el inicio"</Text>
        )}
        {estadoEsp && espOnline && estadoEsp.posicion && (
          <Text style={{ marginTop: 8, fontWeight: 'bold', color:
            estadoEsp.moviendo ? '#2563eb' :
            !estadoEsp.sensor ? '#d97706' :
            estadoEsp.alineado ? '#16a34a' : '#dc2626' }}>
            {estadoEsp.moviendo ? '🔄 Moviéndose...' :
             !estadoEsp.sensor ? 'ℹ Sin sensor: se confía en tu alineación manual' :
             estadoEsp.alineado ? '✅ Alineado en la partición 0' : '⚠ No está alineado en la partición 0'}
          </Text>
        )}
        {estadoEsp && espOnline && estadoEsp.sensor && !estadoEsp.alineado && !estadoEsp.moviendo && (
          <Boton titulo="🧭 Alinear automáticamente" onPress={() => comando('alinear')} color="#d97706" />
        )}
        {aviso.texto !== '' && (
          <Text style={{ marginTop: 8, fontWeight: 'bold', color: aviso.color }}>{aviso.texto}</Text>
        )}
      </View>

      <View style={[styles.card, { alignItems: 'center' }]}>
        <PlatoGiratorio estados={estadosPlato} onTocando={(t) => setScrollOn(!t)} />
        <Text style={{ color: '#888', fontSize: 12, marginTop: 4 }}>Girá el círculo con el dedo</Text>
        <View style={styles.leyenda}>
          {[1, 2, 3, 0].map((e) => (
            <View key={e} style={styles.leyendaItem}>
              <View style={[styles.punto, { backgroundColor: ESTADOS[e].color }]} />
              <Text>{ESTADOS[e].texto}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.subtitulo}>⏰ Horarios de cada partición</Text>
        <Text style={{ color: '#666', marginBottom: 8 }}>
          Poné la hora en la que hay que tomar la pastilla de cada partición y, si querés, una nota (nombre del remedio, dosis, etc.). Dejá vacías las que no tienen pastilla.
        </Text>
        {Array.from({ length: N - 1 }, (_, i) => i + 1).map((s) => {
          const t = tomasEsp[s];
          return (
            <View key={s} style={styles.bloqueToma}>
              <View style={styles.filaToma}>
                <View style={[styles.punto, { backgroundColor: ESTADOS[t ? t.e : 0].color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: 'bold' }}>Partición {s}</Text>
                  {t && <Text style={{ color: '#666', fontSize: 12 }}>{ESTADOS[t.e].texto} · {formatear(t.t)}</Text>}
                </View>
                <TextInput style={styles.hora} value={form[s].h} placeholder="HH"
                  onChangeText={(v) => cambiar(s, 'h', v)} keyboardType="number-pad" maxLength={2} />
                <Text style={{ fontSize: 18, marginHorizontal: 2 }}>:</Text>
                <TextInput style={styles.hora} value={form[s].m} placeholder="MM"
                  onChangeText={(v) => cambiar(s, 'm', v)} keyboardType="number-pad" maxLength={2} />
                <TouchableOpacity onPress={() => borrar(s)}>
                  <Text style={{ fontSize: 18, marginLeft: 8 }}>🗑</Text>
                </TouchableOpacity>
              </View>
              <TextInput style={styles.nota} value={notas[s] || ''}
                placeholder="Nota (ej: Ibuprofeno 400 mg)"
                onChangeText={(v) => cambiarNota(s, v)} maxLength={60} />
            </View>
          );
        })}
        <Boton titulo="💾 Guardar horarios" onPress={guardarHorarios} deshabilitado={!conectado} color="#16a34a" />
      </View>

      <View style={[styles.card, styles.botones]}>
        <Boton titulo="⏮ Ya alineé el inicio" onPress={() => comando('inicio')} deshabilitado={!(conectado && espOnline)} />
        <Boton titulo="🔍 Verificar alineación" onPress={() => comando('verificar')} deshabilitado={!(conectado && espOnline)} />
        <Boton titulo="🔔 Probar alarma" onPress={() => comando('buzzer')} deshabilitado={!(conectado && espOnline)} />
      </View>

      <TouchableOpacity onPress={() => setVerLog(!verLog)}>
        <Text style={{ color: '#888', textAlign: 'center', marginBottom: 8 }}>
          {verLog ? 'Ocultar detalles técnicos' : 'Ver detalles técnicos'}
        </Text>
      </TouchableOpacity>
      {verLog && (
        <View style={[styles.card, { backgroundColor: '#111' }]}>
          {log.map((l, i) => <Text key={i} style={styles.logTexto}>{l}</Text>)}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#f4f6f8' },
  titulo: { fontSize: 26, fontWeight: 'bold', marginBottom: 12 },
  subtitulo: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 14, elevation: 2 },
  alerta: { marginTop: 8, color: '#dc2626' },
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 6 },
  punto: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: '#555', marginRight: 6 },
  bloqueToma: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  filaToma: { flexDirection: 'row', alignItems: 'center' },
  hora: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, width: 46, padding: 6, fontSize: 18, textAlign: 'center' },
  nota: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, fontSize: 15, marginTop: 8, backgroundColor: '#fafafa' },
  botones: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  boton: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, margin: 4, alignItems: 'center' },
  botonOff: { backgroundColor: '#9ca3af' },
  botonTexto: { color: '#fff', fontSize: 17 },
  logTexto: { color: '#4ade80', fontFamily: 'monospace', fontSize: 12 },
});