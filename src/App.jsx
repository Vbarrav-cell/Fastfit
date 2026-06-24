import { useState, useEffect, useRef } from "react";
import * as API from "./api.js";

/* ════════════════════════════════════════════════════════════════
   FastFit — App con backend REAL (Express + SQLite + Anthropic API)
   - Auth, datos y social viven en el servidor (server/index.js)
   - La IA se llama a traves del proxy /api/claude (tu API key en .env)
═══════════════════════════════════════════════════════════════════ */

/* ═══════════ CACHE LOCAL + SYNC CON BACKEND REAL ═══════════
   Los componentes leen/escriben de forma sincrona (cache),
   y cada escritura se envia al servidor en segundo plano. */
const cache = {};  // { "uid_key": value }
const uk=(u,t)=>`${u}_${t}`;

// Mapa de que key corresponde a que endpoint del backend
function syncToServer(uid, key, value){
  try{
    if(key==="profile") API.putProfile(value);
    else if(key==="avatar") API.putAvatar(value);
    else if(key==="muscle_weights") API.putMuscleWeights(value);
    else if(key==="medals") API.putMedals(value);
    else API.putData(key, value);  // workout_plans, meal_plans, progress_logs, completed_workouts, mental_surveys
  }catch(e){ console.warn("sync error", key, e); }
}

const db = {
  get: k => cache["__"+k] ?? null,
  set: (k,v) => { cache["__"+k]=v; },
  del: k => { delete cache["__"+k]; },
};
const getMany=(u,t)=> cache[uk(u,t)] || [];
const setMany=(u,t,d)=>{ cache[uk(u,t)]=d; syncToServer(u,t,d); };
const getOne =(u,t)=> cache[uk(u,t)] ?? null;
const setOne =(u,t,d)=>{ cache[uk(u,t)]=d; syncToServer(u,t,d); };

// Carga TODOS los datos del usuario desde el backend al iniciar sesion
async function loadUserData(uid){
  const keys=["workout_plans","meal_plans","progress_logs","completed_workouts","mental_surveys"];
  try{
    const [profile, avatar, mw, medals, ...datas] = await Promise.all([
      API.getProfile(), API.getAvatar(), API.getMuscleWeights(), API.getMedals(),
      ...keys.map(k=>API.getData(k))
    ]);
    cache[uk(uid,"profile")] = profile;
    cache[uk(uid,"avatar")] = avatar;
    cache[uk(uid,"muscle_weights")] = mw || {};
    cache[uk(uid,"medals")] = medals || {};
    keys.forEach((k,i)=>{ cache[uk(uid,k)] = datas[i] || []; });
  }catch(e){ console.warn("loadUserData error", e); }
}

/* ═══════════ IA REAL (via backend -> Anthropic) ═══════════ */
const WTPL={
  // ── HIPERTROFIA (tabla: Push/Pull/Legs + Upper/Lower, 4x8-12, descanso 1-2 min) ──
  hipertrofia:{title:"Hipertrofia Maxima",split:"Push/Pull/Legs + Upper/Lower",rest:90,slots:[
    {label:"Empuje A",exs:["Press de Banca 4x8-12","Press de Banca Inclinado 4x8-12","Aperturas con Mancuernas 4x12","Press Militar 4x8-12","Elevaciones Laterales 4x15"]},
    {label:"Traccion A",exs:["Peso Muerto Rumano 4x8-12","Dominadas Lastradas 4x8-12","Remo con Barra 4x8-12","Remo T 4x10","Curl con Barra 4x12"]},
    {label:"Pierna A",exs:["Sentadilla 4x10-15","Prensa de Piernas 4x12","Peso Muerto Rumano con Mancuernas 4x12","Zancadas 4x12","Gemelos de Pie 4x15"]},
    {label:"Torso B",exs:["Press de Banca con Mancuernas 4x8-12","Dominadas Neutras 4x8-12","Press Militar con Mancuernas 4x10","Remo de Pie con Barra 4x12","Fondos 4x10"]},
    {label:"Pierna B",exs:["Sentadilla Frontal 4x10-15","Peso Muerto Sumo 4x10","Extensiones de Piernas 4x15","Curl de Piernas 4x12","Gemelos Sentado 4x20"]},
  ]},
  // ── FUERZA MAXIMA (tabla: Pull/Push/Legs, 5x5 y 4x6, descanso 3-5 min) ──
  fuerza:{title:"Fuerza Maxima",split:"Push/Pull/Legs/Upper",rest:240,slots:[
    {label:"Empuje (Push)",exs:["Sentadilla 5x5","Press de Banca 5x5","Press Militar 5x5"]},
    {label:"Traccion (Pull)",exs:["Peso Muerto 5x5","Dominadas Lastradas 5x5","Remo con Barra 5x5"]},
    {label:"Pierna (Legs)",exs:["Sentadilla Frontal 4x6","Peso Muerto Rumano 4x6","Prensa 4x6"]},
    {label:"Torso (Upper)",exs:["Press de Banca Inclinado 4x6","Remo con Mancuerna 4x6","Fondos Lastrados 4x6"]},
  ]},
  // ── PERDIDA DE GRASA / SALUD INTEGRAL (tabla: Fuerza+Movilidad, LISS, HIIT) ──
  grasa:{title:"Salud Integral y Quema",split:"Fuerza + Cardio",rest:75,slots:[
    {label:"Fuerza y Movilidad",exs:["Sentadilla con Peso Corporal 3x12","Flexiones de Brazos 3x10","Movilidad de Cadera 5 min","Peso Muerto Rumano con Mancuernas 3x12","Plancha Abdominal 3x45s"]},
    {label:"Cardio LISS",exs:["Caminata Rapida 30-45 min","Eliptica 30-45 min","Ciclismo 30-45 min"]},
    {label:"Fuerza y Estabilidad",exs:["Peso Muerto Rumano con Mancuernas 3x12","Press de Banca 3x10","Plancha Abdominal 3x45s","Sentadilla con Peso Corporal 3x12","Movilidad de Cadera 5 min"]},
    {label:"Cardio HIIT",exs:["Sprints en Bici o Cinta 10x30s","Saltos (Opcionales) 10x30s","Burpees 4x8","Mountain Climbers 3x30s"]},
  ]},
  // ── VELOCIDAD EXTREMA (tabla: Tecnica/Potencia, sprints, fuerza explosiva) ──
  velocidad:{title:"Velocidad Extrema",split:"Tecnica y Potencia",rest:240,slots:[
    {label:"Velocidad Pura / Tecnica",exs:["Drills Tecnicos (A-Skips, B-Skips) 6x1","Aceleraciones Cortas (20-30m) 5x20m","Sprints de 60m 4x60m"]},
    {label:"Fuerza Explosiva Upper",exs:["Press de Banca Balistico (40-50% 1RM) 5x3","Remo con Mancuerna (Rapido) 4x6","Push Press Explosivo 4x3"]},
    {label:"Aceleracion y Potencia",exs:["Salidas de Taco 6x1","Saltos Verticales (CMJ) 5x3","Arrastre de Trineo Ligero (10-15m) 5x15m","Sprints Resistidos 4x20m"]},
    {label:"Fuerza Maxima / Coordinacion",exs:["Sentadilla Frontal Explosiva (75% 1RM) 4x3","Peso Muerto Rumano (Rapido) 4x5","Press Militar Rapido 4x3"]},
  ]},
  // ── EXPLOSIVIDAD DEPORTIVA / RESISTENCIA (tabla: Potencia y Transferencia) ──
  resistencia:{title:"Explosividad Deportiva",split:"Potencia y Transferencia",rest:200,slots:[
    {label:"Fuerza Explosiva Lower",exs:["Saltos Verticales (CMJ) 5x3","Sentadilla Explosiva (60-70% 1RM) 4x5","Peso Muerto Rumano (Rapido) 4x6"]},
    {label:"Potencia Upper",exs:["Lanzamiento de Balon Medicinal 5x5","Press de Banca Balistico (45-55% 1RM) 4x3","Remo T (Velocidad) 4x6"]},
    {label:"Aceleracion y Pliometria",exs:["Aceleraciones Cortas (15-20m) 5x4","Saltos en Caja 5x3","Arrastre de Trineo Ligero 4x15m"]},
    {label:"Complejo de Transferencia",exs:["Cargadas de Potencia (Power Clean) 4x3","Dominadas Lastradas (Rapidas) 4x4","Push Press 4x3"]},
  ]},
  // ── BIENESTAR Y MOVILIDAD (tabla: Salud Integral, equilibrio) ──
  bienestar:{title:"Salud Integral",split:"Bienestar y Movilidad",rest:90,slots:[
    {label:"Fuerza y Movilidad",exs:["Sentadilla con Peso Corporal 3x12","Flexiones de Brazos 3x10","Movilidad de Cadera 5 min","Plancha Abdominal 3x45s"]},
    {label:"Cardio LISS",exs:["Caminata Rapida 30-45 min","Eliptica o Ciclismo 30-45 min"]},
    {label:"Fuerza y Estabilidad",exs:["Peso Muerto Rumano con Mancuernas 3x12","Press de Banca 3x10","Plancha Abdominal 3x45s"]},
    {label:"Cardio HIIT",exs:["Sprints en Bici o Cinta 10x30s","Saltos (Opcionales) 10x30s"]},
  ]},
};
function getTpl(goal){const g=(goal||"").toLowerCase();if(g.includes("hipert"))return WTPL.hipertrofia;if(g.includes("fuerza"))return WTPL.fuerza;if(g.includes("grasa")||g.includes("perdida"))return WTPL.grasa;if(g.includes("velocidad"))return WTPL.velocidad;if(g.includes("resist"))return WTPL.resistencia;if(g.includes("bienestar")||g.includes("salud"))return WTPL.bienestar;return WTPL.hipertrofia;}
function buildWorkout(tpl,days){
  const exs=[];
  days.forEach((day,i)=>{const slot=tpl.slots[i%tpl.slots.length];slot.exs.forEach(ex=>{const nm=ex.match(/^([^0-9]+)/),sr=ex.match(/(\d+)x([\d\-]+)/);exs.push({day,split_label:slot.label,name:(nm?nm[1].trim():ex),sets:sr?parseInt(sr[1]):3,reps:sr?sr[2]:"10-12",rest_seconds:90,muscle_group:"Varios",description:"Ejecuta con control tecnico y rango completo"});});});
  return{id:"wp_"+Date.now(),created_at:Date.now(),title:tpl.title,week_number:1,difficulty:"Intermedio",notes:"Split: "+tpl.split,exercises:exs};
}
const MEAL_BANK={
  Desayuno:[
    {name:"Avena proteica con plátano y frutos rojos",ingredients:["80g avena","1 scoop proteína","1 plátano","100g frutos rojos","200ml leche"],base:{calories:480,protein_g:40,carbs_g:62,fat_g:8}},
    {name:"Tortilla de claras con tostadas integrales",ingredients:["6 claras","2 huevos","2 tostadas integrales","½ aguacate","tomate"],base:{calories:440,protein_g:38,carbs_g:36,fat_g:14}},
    {name:"Yogur griego con granola y miel",ingredients:["250g yogur griego","50g granola","1 cucharada miel","frutos rojos"],base:{calories:420,protein_g:30,carbs_g:50,fat_g:9}},
    {name:"Pan integral con huevo y aguacate",ingredients:["2 rebanadas pan integral","2 huevos","½ aguacate","semillas"],base:{calories:450,protein_g:24,carbs_g:38,fat_g:22}},
    {name:"Panqueques de avena y plátano",ingredients:["80g avena","1 plátano","2 huevos","canela","miel"],base:{calories:460,protein_g:26,carbs_g:60,fat_g:12}},
    {name:"Batido verde con avena y mantequilla de maní",ingredients:["1 scoop proteína","espinaca","1 plátano","30g avena","1 cda mantequilla de maní","250ml leche"],base:{calories:490,protein_g:38,carbs_g:54,fat_g:14}},
    {name:"Tazón de requesón con fruta y nueces",ingredients:["200g requesón","1 manzana","30g nueces","canela"],base:{calories:400,protein_g:32,carbs_g:34,fat_g:16}},
    {name:"Tostada francesa integral con fruta",ingredients:["3 rebanadas pan integral","2 huevos","canela","fresas","sirope sin azúcar"],base:{calories:430,protein_g:24,carbs_g:52,fat_g:13}},
    {name:"Bowl de yogur, kiwi y semillas de chía",ingredients:["250g yogur griego","2 kiwis","20g semillas de chía","30g avena"],base:{calories:410,protein_g:28,carbs_g:46,fat_g:12}},
    {name:"Huevos revueltos con espinaca y queso",ingredients:["3 huevos","100g espinaca","40g queso fresco","1 tostada integral"],base:{calories:420,protein_g:30,carbs_g:20,fat_g:24}},
    {name:"Smoothie de frutos rojos y proteína",ingredients:["1 scoop proteína","150g frutos rojos","1 plátano","200ml leche de almendras","30g avena"],base:{calories:440,protein_g:34,carbs_g:58,fat_g:8}},
  ],
  Almuerzo:[
    {name:"Pechuga de pollo con arroz y brócoli",ingredients:["220g pechuga de pollo","160g arroz cocido","200g brócoli","10ml aceite de oliva"],base:{calories:560,protein_g:52,carbs_g:58,fat_g:12}},
    {name:"Salmón al horno con quinoa y espárragos",ingredients:["200g salmón","150g quinoa cocida","150g espárragos","limón"],base:{calories:580,protein_g:46,carbs_g:48,fat_g:20}},
    {name:"Ternera magra con patata y ensalada",ingredients:["200g ternera magra","200g patata cocida","ensalada mixta","10ml aceite de oliva"],base:{calories:600,protein_g:50,carbs_g:52,fat_g:18}},
    {name:"Pavo con pasta integral y verduras",ingredients:["200g pavo","150g pasta integral cocida","calabacín","pimiento","tomate"],base:{calories:570,protein_g:48,carbs_g:62,fat_g:10}},
    {name:"Atún con arroz integral y aguacate",ingredients:["180g atún","160g arroz integral","½ aguacate","maíz","tomate"],base:{calories:590,protein_g:44,carbs_g:60,fat_g:16}},
    {name:"Lentejas con arroz y verduras",ingredients:["200g lentejas cocidas","120g arroz","zanahoria","cebolla","comino"],base:{calories:540,protein_g:28,carbs_g:80,fat_g:8}},
    {name:"Pollo al curry con arroz basmati",ingredients:["200g pollo","150g arroz basmati","leche de coco light","curry","verduras"],base:{calories:610,protein_g:46,carbs_g:64,fat_g:16}},
    {name:"Pescado blanco con boniato y judías verdes",ingredients:["220g pescado blanco","200g boniato","150g judías verdes","aceite de oliva"],base:{calories:560,protein_g:46,carbs_g:54,fat_g:14}},
    {name:"Bowl mexicano de pollo y frijoles",ingredients:["180g pollo","100g arroz","100g frijoles","maíz","aguacate","pico de gallo"],base:{calories:620,protein_g:48,carbs_g:66,fat_g:16}},
    {name:"Salteado de gambas con fideos de arroz",ingredients:["200g gambas","150g fideos de arroz","verduras wok","salsa de soya","jengibre"],base:{calories:550,protein_g:42,carbs_g:64,fat_g:10}},
    {name:"Hamburguesa casera de pavo con patata al horno",ingredients:["180g pavo picado","pan integral","200g patata","lechuga","tomate"],base:{calories:600,protein_g:48,carbs_g:58,fat_g:18}},
  ],
  Snack:[
    {name:"Batido de proteína con almendras",ingredients:["1 scoop proteína","30g almendras","250ml leche"],base:{calories:320,protein_g:32,carbs_g:18,fat_g:16}},
    {name:"Yogur griego con frutos secos",ingredients:["200g yogur griego","30g nueces","miel"],base:{calories:280,protein_g:18,carbs_g:20,fat_g:14}},
    {name:"Tostada integral con pavo",ingredients:["2 tostadas integrales","100g pavo","tomate"],base:{calories:260,protein_g:24,carbs_g:30,fat_g:5}},
    {name:"Fruta con mantequilla de maní",ingredients:["1 manzana","2 cdas mantequilla de maní"],base:{calories:290,protein_g:8,carbs_g:32,fat_g:16}},
    {name:"Requesón con piña",ingredients:["200g requesón","150g piña"],base:{calories:230,protein_g:24,carbs_g:24,fat_g:4}},
    {name:"Hummus con bastones de zanahoria",ingredients:["100g hummus","2 zanahorias","apio"],base:{calories:250,protein_g:9,carbs_g:26,fat_g:13}},
    {name:"Puñado de mix de frutos secos",ingredients:["40g almendras","20g pasas","10g semillas"],base:{calories:300,protein_g:9,carbs_g:24,fat_g:20}},
    {name:"Tortitas de arroz con queso fresco y pavo",ingredients:["3 tortitas de arroz","60g queso fresco","60g pavo"],base:{calories:240,protein_g:20,carbs_g:28,fat_g:6}},
    {name:"Batido de plátano y avena",ingredients:["1 plátano","40g avena","200ml leche","canela"],base:{calories:300,protein_g:12,carbs_g:52,fat_g:6}},
    {name:"Edamames con sal marina",ingredients:["150g edamames","sal marina"],base:{calories:220,protein_g:18,carbs_g:18,fat_g:9}},
  ],
  Cena:[
    {name:"Merluza al vapor con verduras salteadas",ingredients:["220g merluza","300g verduras mixtas","10ml aceite de oliva","ajo"],base:{calories:360,protein_g:44,carbs_g:18,fat_g:12}},
    {name:"Pechuga a la plancha con ensalada verde",ingredients:["200g pechuga","ensalada grande","½ aguacate","aceite de oliva"],base:{calories:380,protein_g:44,carbs_g:12,fat_g:18}},
    {name:"Revuelto de huevos con champiñones",ingredients:["3 huevos","200g champiñones","2 tostadas integrales","perejil"],base:{calories:400,protein_g:28,carbs_g:30,fat_g:18}},
    {name:"Tortilla española con ensalada",ingredients:["3 huevos","150g patata","cebolla","ensalada"],base:{calories:420,protein_g:24,carbs_g:38,fat_g:18}},
    {name:"Wok de tofu con verduras y arroz",ingredients:["200g tofu","150g arroz","brócoli","zanahoria","salsa de soya"],base:{calories:440,protein_g:30,carbs_g:50,fat_g:14}},
    {name:"Crema de calabaza con pollo desmenuzado",ingredients:["crema de calabaza","150g pollo","semillas","pan integral"],base:{calories:360,protein_g:36,carbs_g:28,fat_g:10}},
    {name:"Lubina al horno con verduras mediterráneas",ingredients:["220g lubina","pimiento","tomate","cebolla","hierbas"],base:{calories:400,protein_g:42,carbs_g:18,fat_g:18}},
    {name:"Salmón a la plancha con espárragos",ingredients:["200g salmón","200g espárragos","limón","eneldo"],base:{calories:420,protein_g:42,carbs_g:10,fat_g:24}},
    {name:"Ensalada templada de pollo y garbanzos",ingredients:["150g pollo","120g garbanzos","espinaca","tomate cherry","aceite de oliva"],base:{calories:430,protein_g:40,carbs_g:34,fat_g:14}},
    {name:"Pollo al horno con calabacín y boniato",ingredients:["200g pollo","150g boniato","calabacín","romero"],base:{calories:440,protein_g:46,carbs_g:36,fat_g:10}},
    {name:"Sopa de verduras con pavo y fideos",ingredients:["150g pavo","fideos integrales","caldo de verduras","zanahoria","apio"],base:{calories:360,protein_g:34,carbs_g:32,fat_g:8}},
  ],
};
const DAYS_ES=["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];

// Calcula calorías objetivo según datos del usuario (Mifflin-St Jeor + actividad + objetivo)
function targetCalories(prof){
  const w=parseFloat(prof?.weight_kg)||75;
  const h=parseFloat(prof?.height_cm)||175;
  const age=parseFloat(prof?.age)||28;
  const male=(prof?.sex||"Masculino")!=="Femenino";
  // Metabolismo basal
  let bmr=10*w+6.25*h-5*age+(male?5:-161);
  // Factor de actividad
  const act={"Sedentario":1.3,"Ligeramente activo":1.45,"Moderadamente activo":1.6,"Muy activo":1.75}[prof?.activity_level]||1.5;
  let cal=bmr*act;
  // Ajuste por objetivo
  const goal=(prof?.fitness_goal||"").toLowerCase();
  if(goal.includes("pérdida")||goal.includes("grasa")) cal-=450;
  else if(goal.includes("hipert")||goal.includes("músculo")||goal.includes("fuerza")) cal+=300;
  return Math.round(cal/10)*10;
}

// Genera un plan semanal variado ajustado al usuario
function generateMealPlan(prof){
  const dailyTarget=targetCalories(prof);
  // Suma de calorías base de una combinación promedio ≈ 1800 (480+560+320+440). Escalamos.
  const meals=[];
  // Cada generación empieza en un punto aleatorio del banco -> planes distintos cada vez.
  // Y dentro de la semana, cada día avanza una posición distinta -> 7 días sin repetir.
  const types=["Desayuno","Almuerzo","Snack","Cena"];
  const starts={};
  types.forEach((type,i)=>{
    const bank=MEAL_BANK[type];
    starts[type]=Math.floor(Math.random()*bank.length); // punto de inicio aleatorio
  });
  DAYS_ES.forEach((day,di)=>{
    types.forEach((type,ti)=>{
      const bank=MEAL_BANK[type];
      // desfase combinado para que no se repita el mismo día en distintas comidas
      const idx=(starts[type]+di*1+ti)%bank.length;
      const item=bank[idx];
      meals.push({day,meal_type:type,name:item.name,ingredients:item.ingredients,...item.base});
    });
  });
  // Escalar todas las comidas para acercarse al objetivo calórico del usuario
  const rawDaily=meals.slice(0,4).reduce((s,m)=>s+m.calories,0);
  const factor=Math.max(0.7,Math.min(1.5,dailyTarget/rawDaily));
  const scaled=meals.map(m=>({
    ...m,
    calories:Math.round(m.calories*factor/5)*5,
    protein_g:Math.round(m.protein_g*factor),
    carbs_g:Math.round(m.carbs_g*factor),
    fat_g:Math.round(m.fat_g*factor),
  }));
  const goalLabel=prof?.fitness_goal||"Bienestar general";
  return {
    id:"mp_"+Date.now(),created_at:Date.now(),week_number:1,
    title:`Plan ${goalLabel} — Semana 1`,
    daily_calories:dailyTarget,
    notes:`Plan personalizado para tu objetivo (${goalLabel}). Bebe 2.5-3L de agua al día y ajusta las porciones según tu hambre y energía.`,
    meals:scaled,
  };
}

// Genera la rutina con IA real; si falla, usa plantilla
// Principios de entrenamiento (extraidos de tablas profesionales) que guian a la IA
const TRAINING_GUIDE=`PRINCIPIOS POR OBJETIVO (usalos como base):
- HIPERTROFIA: split Push/Pull/Legs + Upper/Lower. 4 series de 8-12 reps (piernas 10-15). Descanso 1-2 min. Claves: sobrecarga progresiva, volumen alto, tiempo bajo tension (TUT). Ejercicios base: press banca/inclinado, aperturas, press militar, elevaciones laterales, peso muerto rumano, dominadas lastradas, remo barra/T, curl barra, sentadilla, prensa, zancadas, gemelos.
- FUERZA MAXIMA: split Push/Pull/Legs/Upper. 5x5 en basicos, 4x6 en accesorios. Descanso 3-5 min. Claves: sobrecarga progresiva, tecnica perfecta, recuperacion optima. Ejercicios: sentadilla, press banca, press militar, peso muerto, dominadas lastradas, remo barra, sentadilla frontal, peso muerto rumano.
- VELOCIDAD: enfoque tecnica y potencia. Drills (A-skips, B-skips), sprints 20-60m, fuerza explosiva 5x3 al 40-50% 1RM, saltos CMJ, trineo, pliometria. Descanso 3-5 min (recuperacion total del sistema nervioso). Clave: maxima intensidad cada sprint, evitar fatiga metabolica.
- RESISTENCIA/EXPLOSIVIDAD DEPORTIVA: potencia y transferencia. Saltos verticales, sentadilla explosiva 60-70% 1RM, lanzamiento balon medicinal, cargadas de potencia, pliometria. Series 4-5x3-6. Descanso 2-4 min. Clave: maxima velocidad en fase concentrica.
- PERDIDA DE GRASA / SALUD INTEGRAL: combina fuerza+movilidad (3x10-12), cardio LISS (30-45 min continuo) y cardio HIIT (10x30s on/off). Descanso 1-2 min en fuerza. Claves: consistencia, variedad de estimulos, deficit calorico moderado.
- BIENESTAR/MOVILIDAD: equilibrio entre fuerza suave, movilidad y cardio ligero. Escuchar al cuerpo.`;

async function genWorkout(profile,days,equip){
  const goal=profile?.fitness_goal||"general";
  const tpl=getTpl(goal);
  try{
    const sys="Eres un entrenador personal de elite. Disenas rutinas personalizadas y bien razonadas. Respondes SOLO con JSON puro y valido, sin markdown ni texto extra.";
    const refPlan=tpl.slots.map((s,i)=>(i+1)+". "+s.label+": "+s.exs.join(", ")).join("\n");
    const prompt=
"Disena una rutina semanal PERSONALIZADA y bien pensada.\n\n"+
"PERFIL DEL USUARIO:\n"+
"- Objetivo: "+goal+"\n"+
"- Peso: "+(profile?.weight_kg||"?")+"kg | Altura: "+(profile?.height_cm||"?")+"cm | Edad: "+(profile?.age||"?")+" | Sexo: "+(profile?.sex||"?")+"\n"+
"- Nivel de actividad: "+(profile?.activity_level||"moderado")+"\n"+
"- Equipamiento disponible: "+(equip.join(", ")||"peso corporal")+"\n"+
"- Dias que entrenara: "+days.join(", ")+" ("+days.length+" dias)\n\n"+
TRAINING_GUIDE+"\n\n"+
"PLAN DE REFERENCIA para este objetivo (usalo como base, adaptalo al equipamiento y nivel):\n"+refPlan+"\n\n"+
"INSTRUCCIONES:\n"+
"1. Crea EXACTAMENTE "+days.length+" dias de entrenamiento, uno por cada dia indicado ("+days.join(", ")+"). Reparte los enfoques de forma logica (no repitas el mismo musculo dos dias seguidos).\n"+
"2. Si el objetivo NO encaja con los planes de referencia, RAZONA y disena tu propia rutina con principios solidos de entrenamiento.\n"+
"3. Adapta los ejercicios al equipamiento disponible. Si solo hay peso corporal, sustituye los de barra/maquina por equivalentes.\n"+
"4. 5 a 6 ejercicios por dia. Usa las series, repeticiones y descansos correctos para el objetivo (ver principios).\n"+
"5. En cada ejercicio incluye una descripcion breve de tecnica.\n\n"+
"Responde SOLO con este JSON:\n"+
'{"title":"'+tpl.title+'","week_number":1,"difficulty":"Intermedio","notes":"'+tpl.split+'","exercises":[{"day":"'+days[0]+'","split_label":"Empuje","name":"Press de Banca","sets":4,"reps":"8-12","rest_seconds":'+(tpl.rest||90)+',"muscle_group":"Pecho","description":"Baja la barra al pecho con control"}]}';
    const raw=await API.callAI([{role:"user",content:prompt}],sys,4000);
    const plan=API.parseJSON(raw);
    // Validar que la IA respeto los dias; si no, usar fallback
    const planDays=[...new Set((plan.exercises||[]).map(e=>e.day))];
    if(!plan.exercises||plan.exercises.length<days.length*3||planDays.length<Math.min(days.length,2)){
      return buildWorkout(tpl,days);
    }
    return {...plan,id:"wp_"+Date.now(),created_at:Date.now()};
  }catch(_){ return buildWorkout(tpl,days); }
}
async function genMeal(profile){
  // Usamos el generador local: es variado (7 dias distintos), personalizado por
  // calorias/peso/objetivo, y siempre funciona (no depende de que la IA devuelva JSON valido).
  return generateMealPlan(profile);
}
async function genAnalysis(logs,completed){
  try{ return await API.callAI([{role:"user",content:"Analiza el progreso. Directo, motivador. Max 200 palabras espanol.\nMedidas:"+JSON.stringify(logs.slice(0,5))+"\nEntrenos:"+JSON.stringify(completed.slice(0,8))}],"Coach de alto rendimiento.",700); }
  catch(_){ return "No se pudo generar el analisis. Verifica tu conexion."; }
}
async function genMental(responses){
  const def={energy_level:7,sleep_quality:6,stress_level:5,motivation:8,mood:7,anxiety_level:4,overall_wellbeing:7,physical_strength:7,physical_endurance:6,flexibility:5,pain_level:3,recovery:7,appetite:8,mental_score:6.7,physical_score:6.3,total_score:6.5,insights:"Continua con tus habitos saludables."};
  try{
    const sys="Psicologo deportivo. Responde SOLO JSON valido.";
    const prompt="Analiza estas respuestas y asigna puntuaciones 1-10. SOLO JSON:\n"+JSON.stringify(responses)+"\n"+JSON.stringify(def);
    return API.parseJSON(await API.callAI([{role:"user",content:prompt}],sys,600));
  }catch(_){ return def; }
}
async function genChat(history,profile){
  try{
    const sys="Coach de fitness y nutricion. Responde en espanol, directo y conciso. Perfil del usuario: "+JSON.stringify(profile||{});
    return await API.callAI(history.map(m=>({role:m.role,content:m.content})),sys,600);
  }catch(_){ return "Error de conexion con la IA. Revisa tu API key e intentalo de nuevo."; }
}

/* ═══════════ SISTEMA DE RANGOS DE FUERZA ═══════════ */
const RANKS=[
  {name:"Hierro",color:"#6b7280",glow:"rgba(107,114,128,.4)"},
  {name:"Bronce",color:"#b45309",glow:"rgba(180,83,9,.45)"},
  {name:"Plata",color:"#94a3b8",glow:"rgba(148,163,184,.5)"},
  {name:"Oro",color:"#eab308",glow:"rgba(234,179,8,.5)"},
  {name:"Platino",color:"#22d3ee",glow:"rgba(34,211,238,.5)"},
  {name:"Diamante",color:"#a855f7",glow:"rgba(168,85,247,.55)"},
  {name:"Elite",color:"#f43f5e",glow:"rgba(244,63,94,.6)"},
];
const MUSCLES=[
  {key:"chest",label:"Pecho",ex:"Press de Banca",icon:"\uD83D\uDCAA"},
  {key:"legs",label:"Pierna",ex:"Sentadilla",icon:"\uD83E\uDDB5"},
  {key:"back",label:"Espalda",ex:"Peso Muerto",icon:"\uD83C\uDFCB\uFE0F"},
  {key:"shoulder",label:"Hombro",ex:"Press Militar",icon:"\uD83E\uDD3E"},
  {key:"arms",label:"Biceps",ex:"Curl con Barra",icon:"\uD83D\uDCAA"},
];
// Ratios (x peso corporal) — umbral minimo de cada rango
const RATIOS_M={chest:[.25,.50,.75,1.0,1.25,1.5,2.0],legs:[.50,.75,1.25,1.5,1.75,2.25,2.75],back:[.50,1.0,1.5,1.75,2.0,2.5,3.0],shoulder:[.20,.35,.55,.70,.85,1.05,1.40],arms:[.15,.30,.45,.55,.65,.80,1.0]};
const RATIOS_F={chest:[.18,.35,.50,.65,.80,1.0,1.40],legs:[.40,.60,.90,1.10,1.35,1.70,2.10],back:[.50,.75,1.10,1.35,1.60,2.0,2.40],shoulder:[.15,.25,.40,.50,.60,.75,1.0],arms:[.10,.20,.30,.40,.48,.60,.75]};
function ageFactor(age){
  const a=parseFloat(age)||28;
  if(a<18) return 1.05;
  if(a<=30) return 1.0;
  if(a<=40) return 0.95;
  if(a<=50) return 0.88;
  if(a<=60) return 0.80;
  return 0.72;
}
function rankFor(muscleKey,weightLifted,bodyweight,sex,age){
  if(!weightLifted||!bodyweight)return{idx:-1,...{name:"Sin datos",color:"#44444d",glow:"none"}};
  const baseRatios=(sex==="Femenino"?RATIOS_F:RATIOS_M)[muscleKey];
  const ratios=baseRatios.map(x=>x*ageFactor(age));
  const r=weightLifted/bodyweight;
  let idx=-1;
  for(let i=0;i<ratios.length;i++){if(r>=ratios[i])idx=i;}
  if(idx<0)return{idx:-1,name:"Sin rango",color:"#44444d",glow:"none",ratio:r};
  return{idx,...RANKS[idx],ratio:r,next:idx<RANKS.length-1?ratios[idx+1]:null};
}

/* ═══════════ MISIONES SEMANALES ═══════════ */
// Cada medalla: icono unico + el COLOR indica nivel (bronce/plata/oro)
const MISSIONS=[
  {id:"m_streak3",icon:"\uD83D\uDD25",title:"Racha de Fuego",desc:"Entrena 3 dias esta semana",level:"bronce",goal:3,metric:"workouts"},
  {id:"m_volume",icon:"\uD83C\uDFCB\uFE0F",title:"Levantador",desc:"Completa 5 entrenamientos",level:"plata",goal:5,metric:"workouts"},
  {id:"m_meal",icon:"\uD83E\uDD57",title:"Nutricion Pro",desc:"Genera tu plan de comidas",level:"bronce",goal:1,metric:"meal_plans"},
  {id:"m_log",icon:"\uD83D\uDCC8",title:"Autoconsciente",desc:"Registra tus medidas",level:"bronce",goal:1,metric:"progress_logs"},
  {id:"m_mental",icon:"\uD83E\uDDE0",title:"Mente Sana",desc:"Completa la encuesta de bienestar",level:"plata",goal:1,metric:"mental_surveys"},
  {id:"m_consist",icon:"\uD83D\uDC8E",title:"Imparable",desc:"Entrena 7 dias esta semana",level:"oro",goal:7,metric:"workouts"},
  {id:"m_strength",icon:"\u2694\uFE0F",title:"Mas Fuerte",desc:"Registra peso en 3 grupos musculares",level:"oro",goal:3,metric:"muscles"},
];
const LEVEL_COLORS={bronce:{c:"#b45309",g:"rgba(180,83,9,.5)",label:"BRONCE"},plata:{c:"#94a3b8",g:"rgba(148,163,184,.5)",label:"PLATA"},oro:{c:"#eab308",g:"rgba(234,179,8,.55)",label:"ORO"}};

function missionProgress(uid,m){
  if(m.metric==="muscles"){
    const mw=getOne(uid,"muscle_weights")||{};
    return Object.values(mw).filter(v=>v>0).length;
  }
  const items=getMany(uid,m.metric);
  // workouts: contar los de esta semana
  if(m.metric==="workouts"){
    const cw=getMany(uid,"completed_workouts");
    const weekAgo=Date.now()-7*24*60*60*1000;
    return cw.filter(w=>w.date>=weekAgo).length;
  }
  return items.length;
}

/* ═══════════ AVATAR BUILDER opciones ═══════════ */
const AV_FACES=["\uD83D\uDE0E","\uD83D\uDCAA","\uD83E\uDD75","\uD83C\uDF1F","\u26A1","\uD83D\uDD25","\uD83D\uDE24","\uD83E\uDDBE","\uD83C\uDFC6","\uD83D\uDC51","\uD83D\uDC3A","\uD83E\uDD81"];
const AV_COLORS=["#3457e8","#22c277","#e0921e","#a855f7","#e0455e","#22d3ee","#f43f5e","#eab308"];

const T={bg:"#0a0a0c",surface:"#101013",card:"#16161a",border:"#26262c",borderSub:"#33333a",bright:"#3457e8",dim:"rgba(52,87,232,0.14)",glow:"rgba(52,87,232,0.3)",text:"#ededf0",sub:"#7c7c87",dimT:"#44444d",ok:"#22c277",err:"#e0455e",warn:"#e0921e",r:"10px",rLg:"14px",rFull:"999px"};
const CC={card:{background:T.card,border:`1px solid ${T.border}`,borderRadius:T.rLg,padding:"18px 20px",marginBottom:10},lbl:{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:T.sub,display:"block",marginBottom:6},inp:{padding:"12px 14px",fontSize:14,borderRadius:T.r,border:`1px solid ${T.border}`,background:T.card,color:T.text},mono:{fontFamily:"'Space Mono',monospace"}};

function Logo({h=28}){
  const fs=Math.round(h*1.38);
  const bH=Math.round(fs*0.92);   // rayo a la altura de la mayuscula
  const bW=Math.round(bH*0.5);
  const txt={fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:fs,color:"#fff",letterSpacing:"-1.5px",lineHeight:1,display:"inline-block"};
  return(<div style={{display:"inline-flex",alignItems:"center",userSelect:"none",lineHeight:1}}>
    <span style={txt}>FASTF</span>
    <svg width={bW} height={bH} viewBox="0 0 22 44" fill="none" style={{flexShrink:0,margin:"0 1px",display:"block",position:"relative",top:"-1px"}}>
      <polygon points="16,0 6,20 12,20 3,44 21,15 13,15 22,0" fill={T.bright} style={{filter:`drop-shadow(0 0 7px ${T.glow})`}}/>
    </svg>
    <span style={txt}>T</span>
  </div>);
}

function Btn({ch,v="p",onClick,disabled,sx={},sm}){
  const base={padding:sm?"7px 13px":"13px 20px",borderRadius:T.r,fontSize:sm?12:14,fontWeight:700,fontFamily:"inherit",border:"none",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",cursor:disabled?"not-allowed":"pointer",opacity:disabled?.4:1};
  const vs={p:{background:T.bright,color:"#fff",boxShadow:`0 0 20px ${T.glow}`},g:{background:"transparent",color:T.sub,border:`1px solid ${T.border}`},o:{background:T.dim,color:T.bright,border:`1px solid rgba(61,32,255,.3)`}};
  return <button onClick={onClick} disabled={disabled} style={{...base,...vs[v],...sx}}>{ch}</button>;
}
function Chip({label,active,onClick,sx={}}){
  return <button onClick={onClick} style={{padding:"8px 14px",borderRadius:T.rFull,fontSize:13,fontWeight:600,border:`1px solid ${active?T.bright:T.border}`,background:active?T.dim:"transparent",color:active?T.bright:T.sub,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",...sx}}>{label}</button>;
}
function Badge({ch,color=T.bright}){return <span style={{background:color+"18",color,borderRadius:6,padding:"3px 9px",fontSize:11,fontWeight:700}}>{ch}</span>;}
function Spin(){return <div style={{width:16,height:16,border:`2px solid ${T.borderSub}`,borderTopColor:T.bright,borderRadius:"50%",animation:"spin .7s linear infinite",flexShrink:0}}/>;}
function bmiCat(b){if(b<18.5)return["Bajo peso",T.warn];if(b<25)return["Saludable",T.ok];if(b<30)return["Sobrepeso",T.warn];return["Obesidad",T.err];}

function LineChart({data}){
  if(!data||data.length<2)return null;
  const W=300,H=80,vals=data.map(d=>d.v),mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
  const pts=data.map((_,i)=>[((i/(data.length-1))*(W-20)+10),H-8-((data[i].v-mn)/rng)*(H-18)]);
  const path=pts.map((p,i)=>`${i===0?"M":"L"}${p[0]},${p[1]}`).join(" ");
  const fill=`${path} L${pts[pts.length-1][0]},${H} L${pts[0][0]},${H} Z`;
  return(<svg width="100%" viewBox={`0 0 ${W} ${H+18}`} style={{overflow:"visible"}}>
    <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.bright} stopOpacity=".28"/><stop offset="100%" stopColor={T.bright} stopOpacity="0"/></linearGradient></defs>
    <path d={fill} fill="url(#lg)"/><path d={path} fill="none" stroke={T.bright} strokeWidth="2" strokeLinecap="round"/>
    {pts.map(([x,y],i)=>(<g key={i}><circle cx={x} cy={y} r="3.5" fill={T.bright}/>{i%Math.ceil(data.length/5)===0&&<text x={x} y={H+14} textAnchor="middle" fill={T.dimT} fontSize="9" fontFamily="inherit">{data[i].label}</text>}</g>))}
  </svg>);
}

function RadarChart({mental,physical,labels}){
  const N=labels.length,CX=115,CY=100,R=70,ang=i=>(i*2*Math.PI/N)-Math.PI/2;
  const pt=(i,r)=>[CX+r*Math.cos(ang(i)),CY+r*Math.sin(ang(i))];
  const poly=vals=>vals.map((v,i)=>pt(i,(v/10)*R).join(",")).join(" ");
  return(<svg viewBox="0 0 230 205" style={{width:"100%",maxWidth:230}}>
    {[.25,.5,.75,1].map(r=><polygon key={r} points={Array.from({length:N},(_,i)=>pt(i,r*R).join(",")).join(" ")} fill="none" stroke={T.border} strokeWidth="1"/>)}
    {Array.from({length:N},(_,i)=>{const[x,y]=pt(i,R),[lx,ly]=pt(i,R+18);return(<g key={i}><line x1={CX} y1={CY} x2={x} y2={y} stroke={T.border} strokeWidth="1"/><text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill={T.sub} fontSize="8" fontFamily="inherit">{labels[i]}</text></g>);})}
    <polygon points={poly(mental)} fill={`${T.bright}22`} stroke={T.bright} strokeWidth="1.5"/>
    <polygon points={poly(physical)} fill={`${T.ok}18`} stroke={T.ok} strokeWidth="1.5"/>
    {mental.map((v,i)=>{const[x,y]=pt(i,(v/10)*R);return<circle key={i} cx={x} cy={y} r="2.5" fill={T.bright}/>;} )}
    {physical.map((v,i)=>{const[x,y]=pt(i,(v/10)*R);return<circle key={i} cx={x} cy={y} r="2.5" fill={T.ok}/>;})}
  </svg>);
}

const ICONS={
  dashboard:"M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  workout:"M18 20V10M12 20V4M6 20v-6",
  meal:"M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM8 12h8M12 8v8",
  progress:"M22 7L13.5 15.5 8.5 10.5 2 17M16 7h6v6",
  mental:"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
  assistant:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  missions:"M12 2l2.4 7.4H22l-6 4.5 2.3 7.1-6.3-4.6L5.7 21l2.3-7.1-6-4.5h7.6z",
  ranks:"M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z",
  social:"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
};
// Nav inferior (movil): los 5 mas usados
const NAVS=[{id:"dashboard",l:"Inicio",d:ICONS.dashboard},{id:"workout",l:"Rutina",d:ICONS.workout},{id:"meal",l:"Nutricion",d:ICONS.meal},{id:"social",l:"Social",d:ICONS.social},{id:"assistant",l:"Coach",d:ICONS.assistant}];
// Sidebar (desktop): todo
const NAVS_FULL=[{id:"dashboard",l:"Inicio",d:ICONS.dashboard},{id:"workout",l:"Rutina",d:ICONS.workout},{id:"meal",l:"Nutricion",d:ICONS.meal},{id:"progress",l:"Progreso",d:ICONS.progress},{id:"mental",l:"Mental",d:ICONS.mental},{id:"missions",l:"Misiones",d:ICONS.missions},{id:"ranks",l:"Rangos",d:ICONS.ranks},{id:"social",l:"Social",d:ICONS.social},{id:"assistant",l:"Coach IA",d:ICONS.assistant}];


/* YouTube embebido: mapa ejercicio -> videoId. Para los no mapeados,
   usamos youtube-nocookie con search embed via lista de resultados. */
const EX_VIDEOS={
  "press de banca":"rT7DgCr-3pg","press inclinado mancuernas":"8iPEnn-ltC8","aperturas con mancuernas":"eozdVDA78K0",
  "press militar":"qEwKCR5JCog","elevaciones laterales":"3VcKaXpzqRo","fondos con lastre":"wjUmnZH528Y",
  "peso muerto rumano":"JCXUYuzwNrM","dominadas lastradas":"eGo4IYlbE5g","remo con barra":"9efgcAjQe7E",
  "remo t":"j3Igk5nyZE4","curl con barra":"kwG2ipFRgfo","curl martillo":"zC3nLlEvin4",
  "sentadilla":"ultWZbUMPL8","prensa de piernas":"IZxyjW7MPJQ","zancadas caminando":"L8fvypPrzzs",
  "gemelos de pie":"-M4-G8p8fmc","curl de piernas":"1Tq3QdYUuHs","sentadilla frontal":"uYumuL_G_V0",
  "peso muerto":"op9kVnSso6Q","press militar con barra":"2yjwXTZQDDI",
  "flexiones":"IODxDxX7oi4","flexiones de brazos":"IODxDxX7oi4","plancha":"pSHjTRCQxIw","plancha abdominal":"pSHjTRCQxIw",
  "burpees":"auBLPXO8Fww","mountain climbers":"nmwgirgXLYM","sprints en bici":"D8AXBYJqq2A",
  "peso muerto con mancuernas":"GdW7t9bdLfg","movilidad de cadera":"vBxJjC-Dg5g","caminata rapida":"njeZ29umqVE",
  "eliptica baja intensidad":"njeZ29umqVE"
};
function videoId(name){
  const n=name.toLowerCase().trim();
  if(EX_VIDEOS[n]) return EX_VIDEOS[n];
  const key=Object.keys(EX_VIDEOS).find(k=>n.includes(k)||k.includes(n));
  return key?EX_VIDEOS[key]:null;
}
function VideoModal({name,onClose}){
  const vid=videoId(name);
  return(<div className="modal-ov" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.94)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,width:"100%",maxWidth:560,overflow:"hidden"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",borderBottom:`1px solid ${T.border}`}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,flex:1,marginRight:10}}>{name}</div>
        <button onClick={onClose} style={{background:"none",border:"none",color:T.sub,fontSize:22,cursor:"pointer",lineHeight:1}}>{"\u00D7"}</button>
      </div>
      <div style={{position:"relative",width:"100%",paddingBottom:"56.25%",background:"#000"}}>
        {vid?(
          <iframe src={`https://www.youtube-nocookie.com/embed/${vid}?rel=0&modestbranding=1`} title={name} frameBorder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowFullScreen style={{position:"absolute",top:0,left:0,width:"100%",height:"100%"}}/>
        ):(
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:20,textAlign:"center"}}>
            <span style={{fontSize:40}}>{"\uD83C\uDFA5"}</span>
            <p style={{fontSize:13,color:T.sub}}>No hay video para este ejercicio.</p>
            <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(name+" tutorial")}`} target="_blank" rel="noreferrer" style={{color:T.bright,fontSize:13,fontWeight:700,textDecoration:"none"}}>Buscar en YouTube {"\u2197"}</a>
          </div>
        )}
      </div>
    </div>
  </div>);
}

function SideBar({page,setPage}){
  return(<div className="sidebar">
    <div style={{marginBottom:36,paddingLeft:8}}><Logo h={24}/></div>
    {NAVS_FULL.map(({id,l,d})=>{const a=page===id;return(
      <div key={id} onClick={()=>setPage(id)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:10,cursor:"pointer",color:a?T.bright:T.sub,background:a?T.dim:"transparent",marginBottom:4,fontWeight:a?700:500,fontSize:14,transition:"all .15s"}}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d.split("M").filter(Boolean).map((seg,i)=><path key={i} d={"M"+seg}/>)}</svg>
        <span>{l}</span>
      </div>);})}
    <div style={{marginTop:"auto",fontSize:10,color:"#35375a",paddingLeft:8}}>FastFit Preview</div>
  </div>);
}

function NavBar({page,setPage}){
  return(<div className="nav-shell" style={{position:"fixed",bottom:0,left:0,right:0,background:`${T.surface}f2`,backdropFilter:"blur(20px)",borderTop:`1px solid ${T.border}`,display:"flex",zIndex:999,height:60}}>
    {NAVS.map(({id,l,d})=>{const a=page===id;return(<div key={id} onClick={()=>setPage(id)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,cursor:"pointer",color:a?T.bright:T.dimT}}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d.split("M").filter(Boolean).map((seg,i)=><path key={i} d={"M"+seg}/>)}</svg>
      <span style={{fontSize:9,fontWeight:a?800:500,letterSpacing:".05em"}}>{l.toUpperCase()}</span>
    </div>);})}
  </div>);
}

function AuthPage({onLogin}){
  const[mode,setMode]=useState("login");
  const[f,setF]=useState({email:"",password:"",name:""});
  const[e,setE]=useState("");
  const[busy,setBusy]=useState(false);
  const set=k=>ev=>setF(p=>({...p,[k]:ev.target.value}));
  const submit=async()=>{
    setE("");
    if(!f.email||!f.password){setE("Completa todos los campos.");return;}
    setBusy(true);
    try{
      const r = mode==="register"
        ? await API.apiRegister(f.email,f.password,f.name)
        : await API.apiLogin(f.email,f.password);
      API.setToken(r.token);
      await loadUserData(r.user.uid);
      onLogin(r.user);
    }catch(err){ setE(err.message||"Error de conexion con el servidor."); }
    setBusy(false);
  };
  return(<div style={{minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",padding:"clamp(16px,5vw,40px)",background:T.bg,boxSizing:"border-box"}}>
    <div style={{width:"100%",maxWidth:"min(400px,92vw)",display:"flex",flexDirection:"column"}}>
      <div style={{marginBottom:"clamp(24px,6vh,44px)",textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center"}}><Logo h={34}/></div>
        <p style={{color:T.sub,marginTop:16,fontSize:"clamp(13px,3.6vw,15px)",lineHeight:1.5}}>Tu entrenador personal con inteligencia artificial.</p>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:"clamp(18px,4vh,26px)"}}>{[["login","Iniciar sesi\u00f3n"],["register","Registrarse"]].map(([m,l])=>(<button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"clamp(10px,2.6vw,13px) 0",borderRadius:T.r,border:`1px solid ${mode===m?T.bright:T.border}`,background:mode===m?T.dim:"transparent",color:mode===m?T.bright:T.sub,fontSize:"clamp(12px,3.4vw,14px)",fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>{l}</button>))}</div>
      <div style={{display:"flex",flexDirection:"column",gap:"clamp(12px,2.6vh,16px)"}}>
        {mode==="register"&&<div><label style={CC.lbl}>Nombre</label><input style={CC.inp} placeholder="Tu nombre" value={f.name} onChange={set("name")}/></div>}
        <div><label style={CC.lbl}>Email</label><input style={CC.inp} type="email" placeholder="correo@ejemplo.com" value={f.email} onChange={set("email")}/></div>
        <div><label style={CC.lbl}>Contrase\u00f1a</label><input style={CC.inp} type="password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" value={f.password} onChange={set("password")} onKeyDown={ev=>ev.key==="Enter"&&submit()}/></div>
        {e&&<p style={{color:T.err,fontSize:13}}>{e}</p>}
        <Btn ch={busy?<><Spin/>Conectando...</>:(mode==="login"?"Entrar":"Crear cuenta")} onClick={submit} disabled={busy}/>
      </div>
    </div>
  </div>);
}

function Onboarding({uid,onDone}){
  const[step,setStep]=useState(0);
  const[d,setD]=useState({fitness_goals:[],custom_goal:"",plays_sport:null,sport:"",height_cm:"",weight_kg:"",age:"",sex:"Masculino",activity_level:""});
  const[creating,setCreating]=useState(false);

  const GOALS=[
    {emoji:"\uD83D\uDC9A",label:"Mejorar mi salud general",value:"Bienestar general"},
    {emoji:"\uD83D\uDCAA",label:"Ganar musculo (Hipertrofia)",value:"Hipertrofia"},
    {emoji:"\uD83D\uDD25",label:"Perder peso / grasa",value:"Perdida de grasa"},
    {emoji:"\uD83C\uDFCB\uFE0F",label:"Ganar fuerza",value:"Fuerza maxima"},
    {emoji:"\uD83C\uDFC3",label:"Mejorar resistencia",value:"Resistencia"},
    {emoji:"\u26A1",label:"Ganar velocidad",value:"Ganar velocidad"},
    {emoji:"\u270F\uFE0F",label:"Otro objetivo",value:"OTRO"},
  ];
  const LEVELS=[
    {emoji:"\uD83D\uDECB\uFE0F",label:"Sedentario",desc:"poco o nada de ejercicio",value:"Sedentario"},
    {emoji:"\uD83D\uDEB6",label:"Ligeramente activo",desc:"1-2 dias/semana",value:"Ligeramente activo"},
    {emoji:"\uD83C\uDFC3",label:"Moderadamente activo",desc:"3-4 dias/semana",value:"Moderadamente activo"},
    {emoji:"\uD83D\uDD25",label:"Muy activo",desc:"5+ dias/semana",value:"Muy activo"},
  ];

  const TOTAL=4;
  const canNext=()=>{
    if(step===0) return d.fitness_goals.length>0&&(!d.fitness_goals.includes("OTRO")||d.custom_goal.trim());
    if(step===1) return d.plays_sport!==null&&(d.plays_sport===false||d.sport.trim());
    if(step===2) return d.height_cm&&d.weight_kg&&d.age;
    if(step===3) return !!d.activity_level;
    return true;
  };

  const finish=async()=>{
    setCreating(true);
    await new Promise(r=>setTimeout(r,1400)); // simula IA creando el perfil
    const h=parseFloat(d.height_cm||175)/100,w=parseFloat(d.weight_kg||75);
    const bmi=(w/(h*h)).toFixed(1);
    const goals=d.fitness_goals.map(g=>g==="OTRO"?d.custom_goal:g).filter(Boolean);
    setOne(uid,"profile",{...d,fitness_goal:goals[0]||"Bienestar general",fitness_goals:goals,bmi,created_at:Date.now()});
    onDone(getOne(uid,"profile"));
  };

  const next=()=>{ if(step<TOTAL-1){setStep(s=>s+1);} else {finish();} };
  const back=()=>setStep(s=>Math.max(0,s-1));

  const optBtn=(active)=>({padding:"15px 18px",borderRadius:T.rLg,border:`1px solid ${active?T.bright:T.border}`,background:active?T.dim:T.card,color:active?T.bright:T.text,textAlign:"left",fontSize:14,fontWeight:600,fontFamily:"inherit",cursor:"pointer",transition:"all .15s",display:"flex",alignItems:"center",gap:10,width:"100%"});

  const SCREENS=[
    // ── PASO 1: OBJETIVO ──
    {icon:"\uD83C\uDFAF",title:"\u00BFCual es tu objetivo?",sub:"Puedes elegir varios. Tu plan se adaptara a todos.",
     body:(<div style={{display:"flex",flexDirection:"column",gap:8}}>
       {GOALS.map(g=>{
         const sel=d.fitness_goals.includes(g.value);
         return(<button key={g.value} onClick={()=>setD({...d,fitness_goals:sel?d.fitness_goals.filter(x=>x!==g.value):[...d.fitness_goals,g.value]})} style={{...optBtn(sel),justifyContent:"space-between"}}>
           <span style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:17}}>{g.emoji}</span><span>{g.label}</span></span>
           <span style={{width:20,height:20,borderRadius:6,border:`2px solid ${sel?T.bright:T.border}`,background:sel?T.bright:"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#fff",flexShrink:0}}>{sel?"\u2713":""}</span>
         </button>);
       })}
       {d.fitness_goals.includes("OTRO")&&(
         <div style={{marginTop:6}}>
           <label style={CC.lbl}>Describe tu objetivo</label>
           <input style={CC.inp} placeholder="ej. Preparar una maraton, rehabilitacion..." value={d.custom_goal} onChange={e=>setD({...d,custom_goal:e.target.value})}/>
         </div>
       )}
     </div>)},
    // ── PASO 2: DEPORTE ──
    {icon:"\u26BD",title:"\u00BFPracticas algun deporte?",sub:"\u00BFQuieres mejorar tus condiciones fisicas para un deporte especifico?",
     body:(<div>
       <div style={{display:"flex",gap:10,marginBottom:d.plays_sport?18:0}}>
         <button onClick={()=>setD({...d,plays_sport:true})} style={{...optBtn(d.plays_sport===true),justifyContent:"center",flex:1}}>
           <span style={{fontSize:15}}>{"\u2705"}</span><span>Si</span>
         </button>
         <button onClick={()=>setD({...d,plays_sport:false,sport:""})} style={{...optBtn(d.plays_sport===false),justifyContent:"center",flex:1}}>
           <span style={{fontSize:15}}>{"\u274C"}</span><span>No</span>
         </button>
       </div>
       {d.plays_sport&&(
         <div>
           <label style={CC.lbl}>\u00BFCual deporte?</label>
           <input style={CC.inp} placeholder="ej. Futbol, Natacion, Boxeo, Ciclismo..." value={d.sport} onChange={e=>setD({...d,sport:e.target.value})}/>
         </div>
       )}
     </div>)},
    // ── PASO 3: METRICAS ──
    {icon:"\uD83D\uDCCF",title:"Tus metricas fisicas",sub:"Necesarias para calcular tu IMC y calorias",
     body:(<div style={{display:"flex",flexDirection:"column",gap:14}}>
       {[["height_cm","Altura (cm)","175"],["weight_kg","Peso (kg)","75"],["age","Edad","28"]].map(([k,l,p])=>(
         <div key={k}><label style={CC.lbl}>{l}</label><input style={CC.inp} type="number" placeholder={p} value={d[k]} onChange={e=>setD({...d,[k]:e.target.value})}/></div>
       ))}
       <div><label style={CC.lbl}>Sexo biologico</label>
         <div style={{display:"flex",gap:8}}>{["Masculino","Femenino"].map(sx=><Chip key={sx} label={sx} active={d.sex===sx} onClick={()=>setD({...d,sex:sx})} sx={{flex:1}}/>)}</div>
       </div>
     </div>)},
    // ── PASO 4: ACTIVIDAD ──
    {icon:"\uD83D\uDCC8",title:"Nivel de actividad",sub:"\u00BFCuanto ejercicio haces actualmente?",
     body:(<div style={{display:"flex",flexDirection:"column",gap:8}}>
       {LEVELS.map(l=>(
         <button key={l.value} onClick={()=>setD({...d,activity_level:l.value})} style={optBtn(d.activity_level===l.value)}>
           <span style={{fontSize:17}}>{l.emoji}</span>
           <span><span style={{fontWeight:700}}>{l.label}</span><span style={{color:d.activity_level===l.value?T.bright:T.sub,fontWeight:400}}> {"\u2014"} {l.desc}</span></span>
         </button>
       ))}
     </div>)},
  ];

  const scr=SCREENS[step];
  const isLast=step===TOTAL-1;

  return(<div style={{padding:"32px 20px 60px"}}>
    <div style={{width:52,height:52,borderRadius:14,background:T.dim,border:`1px solid rgba(61,32,255,.3)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,marginBottom:22}}>{scr.icon}</div>
    <div style={{display:"flex",gap:4,marginBottom:18}}>{SCREENS.map((_,i)=><div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=step?T.bright:T.border,transition:"background .3s"}}/>)}</div>
    <h2 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:8}}>{scr.title}</h2>
    <p style={{fontSize:14,color:T.sub,marginBottom:24,lineHeight:1.5}}>{scr.sub}</p>
    <div style={{marginBottom:28}}>{scr.body}</div>
    <div style={{display:"flex",gap:10}}>
      {step>0&&(
        <button onClick={back} style={{width:52,height:50,borderRadius:T.r,background:T.card,border:`1px solid ${T.border}`,color:T.text,fontSize:18,cursor:"pointer",flexShrink:0,fontFamily:"inherit"}}>{"\u2190"}</button>
      )}
      <Btn
        ch={creating?(<><Spin/>Creando tu perfil...</>):isLast?(<>{"\u2728"} Crear mi perfil con IA</>):(<>Siguiente {"\u2192"}</>)}
        onClick={next}
        disabled={!canNext()||creating}
        sx={{flex:1}}
      />
    </div>
  </div>);
}

function Dashboard({uid,user,setPage}){
  const[prof,setProf]=useState(()=>getOne(uid,"profile"));
  if(!prof)return<Onboarding uid={uid} onDone={p=>setProf(p)}/>;
  const logs=getMany(uid,"progress_logs").sort((a,b)=>b.created_at-a.created_at);
  const done=getMany(uid,"completed_workouts");
  const bmi=parseFloat(prof.bmi||22);
  const[bLabel,bColor]=bmiCat(bmi);
  const thisMonth=done.filter(w=>new Date(w.date).getMonth()===new Date().getMonth()).length;
  return(<div>
    <div style={{padding:"24px 18px 16px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div><Logo h={24}/><p style={{color:T.sub,marginTop:10,fontSize:13}}>Bienvenido, <span style={{color:T.text,fontWeight:700}}>{user.name}</span></p></div>
      <div onClick={()=>setPage("profile")} style={{width:42,height:42,borderRadius:"50%",background:T.dim,border:`1px solid rgba(61,32,255,.4)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:T.bright,cursor:"pointer",flexShrink:0}}>{user.name?.[0]?.toUpperCase()}</div>
    </div>
    <div style={{padding:"0 18px 100px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
        {[{label:"Peso",value:`${prof.weight_kg} kg`,sub:`IMC ${bmi}`},{label:"IMC",value:bLabel,color:bColor},{label:"Objetivo",value:prof.fitness_goal?.split(" ")[0],sub:prof.fitness_goal?.split(" ").slice(1).join(" ")||null},{label:"Entrenos",value:thisMonth,sub:"este mes"}].map((st,i)=>(
          <div key={i} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:T.rLg,padding:"15px 16px"}}>
            <div style={{...CC.lbl,marginBottom:5}}>{st.label}</div>
            <div style={{fontSize:20,fontWeight:800,color:st.color||T.text}}>{st.value}</div>
            {st.sub&&<div style={{fontSize:11,color:T.sub,marginTop:2}}>{st.sub}</div>}
          </div>
        ))}
      </div>
      {logs.length>1&&<div style={{...CC.card,marginBottom:16}}><h3 style={{fontSize:14,fontWeight:700,marginBottom:14}}>Evolucion del peso</h3><LineChart data={[...logs].reverse().slice(-8).map(l=>({v:parseFloat(l.weight_kg),label:new Date(l.created_at).toLocaleDateString("es",{day:"numeric",month:"short"})}))} /></div>}
      <p style={{...CC.lbl,marginBottom:10}}>Acceso rapido</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        {[{label:"Rutina",sub:"Plan de entrenamiento",page:"workout"},{label:"Nutricion",sub:"Plan de comidas",page:"meal"},{label:"Progreso",sub:"Registrar medidas",page:"progress"},{label:"Mental",sub:"Encuesta de bienestar",page:"mental"},{label:"Misiones",sub:"Retos y medallas",page:"missions"},{label:"Rangos",sub:"Tu fuerza por musculo",page:"ranks"},{label:"Social",sub:"Amigos y clanes",page:"social"},{label:"Coach IA",sub:"Chat con asistente",page:"assistant"}].map(q=>(
          <div key={q.page} onClick={()=>setPage(q.page)} onMouseEnter={e=>e.currentTarget.style.borderColor=T.bright} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:T.rLg,padding:16,cursor:"pointer",transition:"border-color .15s"}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>{q.label}</div>
            <div style={{fontSize:11,color:T.sub}}>{q.sub}</div>
          </div>
        ))}
      </div>
    </div>
  </div>);
}

function WorkoutPage({uid}){
  const profile=getOne(uid,"profile");
  const[plans,setPlans]=useState(()=>getMany(uid,"workout_plans"));
  const[active,setActive]=useState(()=>getMany(uid,"workout_plans")[0]||null);
  const[gen,setGen]=useState(false);
  const[modal,setModal]=useState(false);
  const[mStep,setMStep]=useState(1);
  const[days,setDays]=useState([]);
  const[equip,setEquip]=useState([]);
  const[expanded,setExpanded]=useState(null);
  const[live,setLive]=useState(null);
  const[video,setVideo]=useState(null);
  const DAYS=["Lunes","Martes","Miercoles","Jueves","Viernes","Sabado","Domingo"];
  const EQUIP=["Barra y discos","Mancuernas","Maquinas gimnasio","Bandas elasticas","Peso corporal","Kettlebells","TRX"];
  const generate=async()=>{
    setModal(false);setGen(true);
    const plan=await genWorkout(profile,days,equip);
    const updated=[plan,...plans];setPlans(updated);setActive(plan);setMany(uid,"workout_plans",updated);setGen(false);
  };
  if(live)return<LiveWorkout workout={live} uid={uid} onBack={()=>setLive(null)}/>;
  const grouped=active?active.exercises.reduce((acc,ex)=>{if(!acc[ex.day])acc[ex.day]={exs:[],split:ex.split_label};acc[ex.day].exs.push(ex);return acc;},{}):{}; 
  return(<div>
    <div style={{padding:"24px 18px 14px"}}><p style={CC.lbl}>ENTRENAMIENTO</p><h1 style={{fontSize:26,fontWeight:800,color:T.text}}>Mi Rutina</h1></div>
    <div style={{padding:"0 18px 100px"}}>
      <Btn ch={gen?<><Spin/>Generando con IA...</>:"Generar rutina con IA"} onClick={()=>{setModal(true);setMStep(1);}} disabled={gen} sx={{marginBottom:16}}/>
      {plans.length>1&&<div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:14,paddingBottom:4}}>{plans.map(p=><Chip key={p.id} label={p.title?.slice(0,18)} active={active?.id===p.id} onClick={()=>setActive(p)} sx={{flexShrink:0}}/>)}</div>}
      {active&&(<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><span style={{fontSize:13,fontWeight:700}}>{active.title}</span><Badge ch={active.difficulty}/></div>
        {Object.entries(grouped).map(([day,{exs,split}])=>(
          <div key={day} style={CC.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setExpanded(expanded===day?null:day)}>
              <div><div style={{fontSize:15,fontWeight:700}}>{day}</div>{split&&<div style={{fontSize:10,color:T.bright,fontWeight:800,letterSpacing:".08em",marginTop:2}}>{split.toUpperCase()}</div>}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <Btn sm v="p" ch="Iniciar" onClick={e=>{e.stopPropagation();setLive({plan:active,day,exercises:exs});}} sx={{width:"auto"}}/>
                <span style={{color:T.sub,fontSize:11}}>{exs.length} ej.</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.sub} strokeWidth="2" style={{transform:expanded===day?"rotate(180deg)":"none",transition:".2s"}}><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>
            {expanded===day&&(<div style={{marginTop:12,borderTop:`1px solid ${T.border}`,paddingTop:12,display:"flex",flexDirection:"column",gap:7}}>
              {exs.map((ex,i)=>(<div key={i} style={{background:T.surface,borderRadius:T.r,padding:"10px 12px"}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:13,fontWeight:600,flex:1,marginRight:8}}>{ex.name}</span>
                  <button onClick={e=>{e.stopPropagation();setVideo(ex.name);}} style={{background:"none",border:"none",color:T.bright,fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0,fontFamily:"inherit",display:"flex",alignItems:"center",gap:3}}>{"\u25B6"} Video</button>
                </div>
                <div style={{fontSize:12,color:T.sub,marginTop:4}}><span style={{color:T.bright,fontWeight:700,...CC.mono}}>{ex.sets}x{ex.reps}</span>{" · "}{ex.rest_seconds}s descanso{ex.muscle_group&&` · ${ex.muscle_group}`}</div>
                {ex.description&&<div style={{fontSize:11,color:T.dimT,marginTop:3,lineHeight:1.5}}>{ex.description}</div>}
              </div>))}
            </div>)}
          </div>
        ))}
      </>)}
      {!active&&!gen&&<p style={{textAlign:"center",padding:"60px 20px",color:T.sub,fontSize:13}}>Genera tu primera rutina personalizada</p>}
    </div>
    {modal&&(<div className="modal-ov" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:999,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div className="modal-card" style={{background:T.card,borderRadius:"18px 18px 0 0",width:"100%",padding:24,maxHeight:"80vh",overflowY:"auto",border:`1px solid ${T.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h2 style={{fontSize:18,fontWeight:700}}>{mStep===1?"Dias de entrenamiento":"Equipamiento"}</h2>
          <button onClick={()=>setModal(false)} style={{background:"none",border:"none",color:T.sub,fontSize:24,cursor:"pointer",padding:"0 6px"}}>x</button>
        </div>
        {mStep===1?(<>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:24}}>{DAYS.map(d=><Chip key={d} label={d} active={days.includes(d)} onClick={()=>setDays(p=>p.includes(d)?p.filter(x=>x!==d):[...p,d])}/>)}</div>
          <Btn ch="Siguiente" onClick={()=>setMStep(2)} disabled={days.length===0}/>
        </>):(<>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:24}}>{EQUIP.map(e=><Chip key={e} label={e} active={equip.includes(e)} onClick={()=>setEquip(p=>p.includes(e)?p.filter(x=>x!==e):[...p,e])}/>)}</div>
          <Btn ch="Generar plan" onClick={generate}/>
        </>)}
      </div>
    </div>)}
    {video&&<VideoModal name={video} onClose={()=>setVideo(null)}/>}
  </div>);
}

function LiveWorkout({workout,uid,onBack}){
  const{plan,day,exercises}=workout;
  const[cur,setCur]=useState(0);
  const[video,setVideo]=useState(null);
  const[sets,setSets]=useState(()=>exercises.map(ex=>Array.from({length:Math.max(1,parseInt(ex.sets)||3)},()=>({done:false,weight:""}))));
  const[secs,setSecs]=useState(0);
  const[done,setDone]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{ref.current=setInterval(()=>setSecs(s=>s+1),1000);return()=>clearInterval(ref.current);},[]);
  const fmt=s=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const toggle=(ei,si)=>setSets(p=>{const n=p.map(a=>[...a]);n[ei][si]={...n[ei][si],done:!n[ei][si].done};return n;});
  const setW=(ei,si,v)=>setSets(p=>{const n=p.map(a=>[...a]);n[ei][si]={...n[ei][si],weight:v};return n;});
  const finish=()=>{
    clearInterval(ref.current);
    setMany(uid,"completed_workouts",[{id:"cw_"+Date.now(),plan_id:plan.id,plan_title:plan.title,day,duration_seconds:secs,exercises_completed:exercises.length,date:Date.now()},...getMany(uid,"completed_workouts")]);
    setDone(true);
  };
  if(done)return(<div style={{padding:"80px 18px 100px",textAlign:"center"}}>
    <div style={{width:72,height:72,borderRadius:"50%",background:T.ok+"20",border:`2px solid ${T.ok}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:30}}>OK</div>
    <p style={{fontSize:10,fontWeight:800,letterSpacing:".15em",color:T.ok,marginBottom:10}}>COMPLETADO</p>
    <h1 style={{fontSize:28,fontWeight:800,marginBottom:8}}>Sesion finalizada.</h1>
    <p style={{...CC.mono,fontSize:13,color:T.sub,marginBottom:32}}>{fmt(secs)} - {exercises.length} ejercicios - {day}</p>
    <Btn ch="Volver a rutinas" onClick={onBack}/>
  </div>);
  const ex=exercises[cur];
  const curSets=sets[cur]||[];
  const doneSets=curSets.filter(s=>s.done).length;
  return(<div style={{padding:"20px 18px 100px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:T.sub,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",padding:0}}>Salir</button>
      <div style={{...CC.mono,fontSize:24,fontWeight:700,color:T.bright}}>{fmt(secs)}</div>
      <div style={{fontSize:11,color:T.sub}}>{cur+1}/{exercises.length}</div>
    </div>
    <div style={CC.card}>
      <p style={{...CC.lbl,marginBottom:4}}>{ex.muscle_group}</p>
      <h2 style={{fontSize:20,fontWeight:800,marginBottom:6}}>{ex.name}</h2>
      <p style={{fontSize:12,color:T.sub,marginBottom:16,...CC.mono}}>{ex.sets}x{ex.reps} - {ex.rest_seconds}s descanso</p>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {curSets.map((st,i)=>(<button key={i} onClick={()=>toggle(cur,i)} style={{flex:1,aspectRatio:"1",borderRadius:T.r,border:`1px solid ${st.done?T.bright:T.border}`,background:st.done?T.dim:T.surface,color:st.done?T.bright:T.dimT,fontFamily:"inherit",fontWeight:800,fontSize:16,cursor:"pointer"}}>{st.done?"v":i+1}</button>))}
      </div>
      <div style={{display:"flex",gap:8}}>
        <input style={{...CC.inp,flex:1}} type="number" placeholder="Peso usado (kg)" value={curSets[Math.min(doneSets,curSets.length-1)]?.weight||""} onChange={e=>setW(cur,Math.min(doneSets,curSets.length-1),e.target.value)}/>
        <button onClick={()=>setVideo(ex.name)} style={{...CC.inp,width:"auto",padding:"12px 18px",color:T.bright,fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:4,flexShrink:0,cursor:"pointer",fontFamily:"inherit"}}>{"\u25B6"} Video</button>
      </div>
      {ex.description&&<p style={{fontSize:12,color:T.dimT,marginTop:10,lineHeight:1.5}}>{ex.description}</p>}
    </div>
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      {cur>0&&<Btn v="g" ch="Anterior" onClick={()=>setCur(c=>c-1)} sx={{flex:1}}/>}
      {cur<exercises.length-1?<Btn ch="Siguiente" onClick={()=>setCur(c=>c+1)} sx={{flex:1}}/>:<Btn ch="Finalizar sesion" onClick={finish} sx={{flex:1}}/>}
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      {exercises.map((e,i)=>(<div key={i} onClick={()=>setCur(i)} style={{...CC.card,marginBottom:0,cursor:"pointer",padding:"10px 14px",borderColor:i===cur?T.bright:T.border,opacity:i<cur?.45:1}}>
        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,fontWeight:600}}>{e.name}</span><span style={{fontSize:12,fontWeight:700,color:i<cur?T.ok:i===cur?T.bright:T.dimT,...CC.mono}}>{i<cur?"ok":`${e.sets}x${e.reps}`}</span></div>
      </div>))}
    </div>
    {video&&<VideoModal name={video} onClose={()=>setVideo(null)}/>}
  </div>);
}

function MealPage({uid}){
  const[plans,setPlans]=useState(()=>getMany(uid,"meal_plans"));
  const[gen,setGen]=useState(false);
  const[expanded,setExpanded]=useState(null);
  const[detail,setDetail]=useState(null);
  const[imgErr,setImgErr]=useState({});
  const profile=getOne(uid,"profile");
  const generate=async()=>{setGen(true);const plan=await genMeal(profile);const updated=[plan,...plans];setPlans(updated);setMany(uid,"meal_plans",updated);setGen(false);};
  const plan=plans[0];
  const grouped=plan?plan.meals.reduce((acc,m)=>{if(!acc[m.day])acc[m.day]=[];acc[m.day].push(m);return acc;},{}):{}; 
  const MC={Desayuno:T.warn,Almuerzo:T.bright,Cena:"#a78bfa",Snack:T.ok,Merienda:T.ok};
  // Imagenes de comida via Loremflickr (servicio estable, busca en Flickr por keyword)
  // Imagenes fijas y confiables de Unsplash por tipo de comida (siempre cargan)
  const FOOD_IMGS=[
    {kw:["avena","oats","overnight","granola"],url:"https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=600&q=80"},
    {kw:["pancakes","tortita","tostada francesa"],url:"https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&q=80"},
    {kw:["tostada","pan integral"],url:"https://images.unsplash.com/photo-1525351484163-7529414344d8?w=600&q=80"},
    {kw:["huevo","tortilla","revuelto","claras","pochado"],url:"https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=600&q=80"},
    {kw:["pollo","pechuga","wrap","curry"],url:"https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=600&q=80"},
    {kw:["salmon"],url:"https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600&q=80"},
    {kw:["merluza","lubina","bacalao","atun","pescado","gambas"],url:"https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&q=80"},
    {kw:["batido","smoothie","shake","recuperador"],url:"https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=600&q=80"},
    {kw:["yogur","requeson","kiwi"],url:"https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&q=80"},
    {kw:["ensalada","quinoa","verdura","espinaca"],url:"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&q=80"},
    {kw:["ternera","carne","costilla","hamburguesa","pavo"],url:"https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&q=80"},
    {kw:["pasta","fideos"],url:"https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=600&q=80"},
    {kw:["arroz","bowl","mexicano","frijoles"],url:"https://images.unsplash.com/photo-1516684732162-798a0062be99?w=600&q=80"},
    {kw:["sopa","caldo"],url:"https://images.unsplash.com/photo-1547592166-23ac45744acd?w=600&q=80"},
    {kw:["boniato","patata","esparragos","brocoli","calabacin"],url:"https://images.unsplash.com/photo-1518779578993-ec3579fee39f?w=600&q=80"},
    {kw:["frutos secos","almendras","nueces","edamame"],url:"https://images.unsplash.com/photo-1599599810769-bcde5a160d32?w=600&q=80"},
    {kw:["tortitas de arroz","tortita de arroz"],url:"https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=600&q=80"},
  ];
  const DEFAULT_FOOD="https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&q=80";
  const getFoodImg=name=>{
    const n=name.toLowerCase();
    const match=FOOD_IMGS.find(f=>f.kw.some(k=>n.includes(k)));
    return match?match.url:DEFAULT_FOOD;
  };
  return(<div>
    <div style={{padding:"24px 18px 14px"}}><p style={CC.lbl}>NUTRICION</p><h1 style={{fontSize:26,fontWeight:800,color:T.text}}>Plan de Comidas</h1></div>
    <div style={{padding:"0 18px 100px"}}>
      <Btn ch={gen?<><Spin/>Generando...</>:"Generar plan nutricional con IA"} onClick={generate} disabled={gen} sx={{marginBottom:16}}/>
      {plan&&(<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><span style={{fontSize:13,fontWeight:700}}>{plan.title}</span><Badge ch={`${plan.daily_calories} kcal/dia`} color={T.ok}/></div>
        {Object.entries(grouped).map(([day,meals])=>(
          <div key={day} style={CC.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setExpanded(expanded===day?null:day)}>
              <span style={{fontSize:15,fontWeight:700}}>{day}</span>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:11,color:T.sub,...CC.mono}}>{meals.reduce((s,m)=>s+(m.calories||0),0)} kcal</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.sub} strokeWidth="2" style={{transform:expanded===day?"rotate(180deg)":"none",transition:".2s"}}><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>
            {expanded===day&&(<div style={{marginTop:12,borderTop:`1px solid ${T.border}`,paddingTop:12,display:"flex",flexDirection:"column",gap:7}}>
              {meals.map((meal,i)=>(<div key={i} onClick={()=>setDetail(meal)} onMouseEnter={e=>e.currentTarget.style.borderColor=T.bright} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border} style={{background:T.surface,borderRadius:T.r,padding:"11px 13px",cursor:"pointer",border:`1px solid ${T.border}`,transition:"border-color .15s"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                  <div><div style={{fontSize:10,fontWeight:800,color:MC[meal.meal_type]||T.sub,marginBottom:2}}>{meal.meal_type.toUpperCase()}</div><div style={{fontSize:13,fontWeight:600}}>{meal.name}</div></div>
                  <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}><div style={{fontSize:15,fontWeight:800,color:T.bright,...CC.mono}}>{meal.calories}</div><div style={{fontSize:9,color:T.dimT}}>kcal</div></div>
                </div>
                <div style={{display:"flex",gap:5}}>{[["P",meal.protein_g],["C",meal.carbs_g],["G",meal.fat_g]].map(([k,v])=>(<span key={k} style={{fontSize:10,color:T.sub,background:T.card,border:`1px solid ${T.border}`,padding:"2px 7px",borderRadius:T.rFull,...CC.mono}}>{k} {v}g</span>))}</div>
              </div>))}
            </div>)}
          </div>
        ))}
        {plan.notes&&<div style={{...CC.card,color:T.sub,fontSize:13,lineHeight:1.7}}>{plan.notes}</div>}
      </>)}
      {!plan&&!gen&&<p style={{textAlign:"center",padding:"60px 20px",color:T.sub,fontSize:13}}>Genera tu plan nutricional personalizado</p>}
    </div>
    {detail&&(<div className="modal-ov" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:999,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)setDetail(null);}}>
      <div className="modal-card" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:"18px 18px 0 0",width:"100%",maxHeight:"88vh",overflowY:"auto"}}>
        <div style={{position:"relative",width:"100%",height:200,overflow:"hidden",borderRadius:"18px 18px 0 0",background:`linear-gradient(135deg,${T.card},${T.surface})`}}>
          {!imgErr[detail.name]?(<img src={getFoodImg(detail.name)} alt={detail.name} style={{width:"100%",height:"100%",objectFit:"cover",opacity:.9}} loading="eager" onError={()=>setImgErr(p=>({...p,[detail.name]:true}))}/>):(<div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,background:`linear-gradient(135deg,${T.card},${T.surface})`}}><span style={{fontSize:48}}>{"\uD83C\uDF7D\uFE0F"}</span><span style={{fontSize:11,color:T.dimT}}>Sin imagen disponible</span></div>)}
          <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom,rgba(0,0,0,.1) 30%,rgba(14,13,32,.98) 100%)"}}/>
          <div style={{position:"absolute",bottom:14,left:20,right:52}}>
            <div style={{fontSize:10,fontWeight:800,color:MC[detail.meal_type]||T.sub,letterSpacing:".08em",marginBottom:4}}>{detail.meal_type.toUpperCase()}</div>
            <h2 style={{fontSize:17,fontWeight:800,color:"#fff",lineHeight:1.25}}>{detail.name}</h2>
          </div>
          <button onClick={()=>setDetail(null)} style={{position:"absolute",top:14,right:16,background:"rgba(0,0,0,.65)",border:`1px solid ${T.border}`,color:"#fff",width:34,height:34,borderRadius:"50%",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>X</button>
        </div>
        <div style={{padding:"18px 20px 36px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:20}}>
            {[["Kcal",detail.calories,"kcal"],["Prot",detail.protein_g,"g"],["Carbs",detail.carbs_g,"g"],["Grasa",detail.fat_g,"g"]].map(([l,v,u])=>(<div key={l} style={{background:T.surface,borderRadius:T.r,padding:"11px 6px",textAlign:"center",border:`1px solid ${T.border}`}}><div style={{fontSize:16,fontWeight:800,color:T.bright,...CC.mono}}>{v}</div><div style={{fontSize:9,color:T.dimT}}>{u}</div><div style={{fontSize:9,color:T.sub,marginTop:2}}>{l}</div></div>))}
          </div>
          <p style={CC.lbl}>Ingredientes</p>
          {detail.ingredients?.map((ing,i)=>(<div key={i} style={{fontSize:13,color:T.text,padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>{ing}</div>))}
        </div>
      </div>
    </div>)}
  </div>);
}

function ProgressPage({uid}){
  const[logs,setLogs]=useState(()=>getMany(uid,"progress_logs").sort((a,b)=>b.created_at-a.created_at));
  const completed=getMany(uid,"completed_workouts");
  const[form,setForm]=useState({weight_kg:"",body_fat_pct:"",waist_cm:"",chest_cm:"",arm_cm:"",notes:""});
  const[analysis,setAnalysis]=useState("");
  const[analyzing,setAnalyzing]=useState(false);
  const[err,setErr]=useState("");
  const last=logs[0]?new Date(logs[0].created_at):null;
  const canLog=!last||(Date.now()-last.getTime())>21*24*60*60*1000;
  const daysLeft=last?Math.ceil((21*24*60*60*1000-(Date.now()-last.getTime()))/(24*60*60*1000)):0;
  const save=()=>{if(!form.weight_kg){setErr("El peso es obligatorio.");return;}const log={...form,id:"pl_"+Date.now(),created_at:Date.now()};const updated=[log,...logs];setLogs(updated);setMany(uid,"progress_logs",updated);setForm({weight_kg:"",body_fat_pct:"",waist_cm:"",chest_cm:"",arm_cm:"",notes:""});setErr("");};
  const analyze=async()=>{setAnalyzing(true);const t=await genAnalysis(logs,completed);setAnalysis(t);setAnalyzing(false);};
  return(<div>
    <div style={{padding:"24px 18px 14px"}}><p style={CC.lbl}>SEGUIMIENTO</p><h1 style={{fontSize:26,fontWeight:800,color:T.text}}>Progreso</h1></div>
    <div style={{padding:"0 18px 100px"}}>
      <div style={CC.card}>
        <h3 style={{fontSize:14,fontWeight:700,marginBottom:14}}>Registrar medidas</h3>
        {!canLog&&<div style={{background:`${T.warn}12`,border:`1px solid ${T.warn}30`,borderRadius:T.r,padding:"10px 14px",marginBottom:14,fontSize:12,color:T.warn}}>Proximo registro en {daysLeft} dias</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          {[["weight_kg","Peso (kg)"],["body_fat_pct","% Grasa"],["waist_cm","Cintura (cm)"],["chest_cm","Pecho (cm)"],["arm_cm","Brazo (cm)"]].map(([k,l])=>(<div key={k}><label style={CC.lbl}>{l}</label><input style={CC.inp} type="number" placeholder="0" value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} disabled={!canLog}/></div>))}
        </div>
        <div style={{marginBottom:14}}><label style={CC.lbl}>Notas</label><textarea style={{...CC.inp,minHeight:70}} placeholder="Observaciones..." value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} disabled={!canLog}/></div>
        {err&&<p style={{color:T.err,fontSize:12,marginBottom:10}}>{err}</p>}
        <Btn ch="Guardar registro" onClick={save} v={canLog?"p":"g"} disabled={!canLog}/>
      </div>
      {logs.length>1&&<div style={CC.card}><h3 style={{fontSize:14,fontWeight:700,marginBottom:14}}>Evolucion del peso</h3><LineChart data={[...logs].reverse().slice(-10).map(l=>({v:parseFloat(l.weight_kg),label:new Date(l.created_at).toLocaleDateString("es",{day:"numeric",month:"short"})}))} /></div>}
      <div style={CC.card}>
        <h3 style={{fontSize:14,fontWeight:700,marginBottom:14}}>Analisis IA</h3>
        <Btn v="o" ch={analyzing?<><Spin/>Analizando...</>:"Generar analisis mensual"} onClick={analyze} disabled={analyzing||logs.length===0} sx={{marginBottom:analysis?14:0}}/>
        {logs.length===0&&<p style={{fontSize:12,color:T.dimT,marginTop:8}}>Necesitas al menos un registro</p>}
        {analysis&&<p style={{fontSize:13,color:T.sub,lineHeight:1.8,whiteSpace:"pre-wrap",marginTop:14}}>{analysis}</p>}
      </div>
      {completed.length>0&&<div style={CC.card}><h3 style={{fontSize:14,fontWeight:700,marginBottom:14}}>Historial de entrenamientos</h3>{completed.slice(0,10).map((w,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:i<Math.min(completed.length,10)-1?`1px solid ${T.border}`:"none"}}><div><div style={{fontSize:13,fontWeight:600}}>{w.plan_title}</div><div style={{fontSize:11,color:T.sub,marginTop:2}}>{w.day} - {new Date(w.date).toLocaleDateString("es")}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:800,color:T.bright,...CC.mono}}>{Math.floor(w.duration_seconds/60)}min</div><div style={{fontSize:10,color:T.dimT}}>{w.exercises_completed} ej.</div></div></div>))}</div>}
    </div>
  </div>);
}

function MentalPage({uid}){
  const[surveys,setSurveys]=useState(()=>getMany(uid,"mental_surveys"));
  const[phase,setPhase]=useState(null); // null | "intro_mental" | "mental" | "intro_fisica" | "fisica" | "scoring"
  const[catIdx,setCatIdx]=useState(0);
  const[ans,setAns]=useState({});
  const[scoring,setScoring]=useState(false);

  const monthLabel=new Date().toLocaleDateString("es",{month:"long",year:"numeric"});

  // ── CATEGORIAS MENTALES (de las imagenes) ──
  const MENTAL_CATS=[
    {key:"energy",emoji:"\u26A1",title:"Nivel de energia",qs:[
      "\u00BFComo describirias tu nivel de energia en general durante los ultimos dias? \u00BFTe sientes con vitalidad o agotado/a?",
      "\u00BFHay momentos del dia en que tu energia cae mucho? \u00BFCuando y por que crees que ocurre?",
      "\u00BFCuantas horas duermes aproximadamente y sientes que es suficiente para recuperarte?"]},
    {key:"sleep",emoji:"\uD83C\uDF19",title:"Calidad de sueno",qs:[
      "\u00BFTienes dificultad para quedarte dormido/a o te despiertas varias veces durante la noche?",
      "\u00BFComo te sientes al despertar? \u00BFDescansado/a o cansado/a?",
      "\u00BFAlgo en particular interrumpe tu sueno (ruido, estres, pantallas, etc.)?"]},
    {key:"stress",emoji:"\uD83D\uDE2B",title:"Nivel de estres",qs:[
      "\u00BFQue situaciones del dia a dia te generan mas estres o ansiedad actualmente?",
      "\u00BFCon que frecuencia sientes que el estres afecta tu rendimiento fisico o mental?",
      "\u00BFTienes estrategias para manejar el estres (respiracion, ejercicio, meditacion)? \u00BFFuncionan?"]},
    {key:"motivation",emoji:"\uD83D\uDD25",title:"Motivacion",qs:[
      "\u00BFQue tan motivado/a te sientes para entrenar y cuidar tu salud esta semana?",
      "\u00BFHay algo que te frene a la hora de cumplir tus objetivos fitness?",
      "\u00BFQue es lo que mas te motiva a seguir con tu rutina de entrenamiento?"]},
    {key:"mood",emoji:"\uD83D\uDE0A",title:"Estado de animo",qs:[
      "\u00BFComo describirias tu estado emocional general en los ultimos dias?",
      "\u00BFHas tenido momentos de tristeza, frustracion o irritabilidad frecuentes?",
      "\u00BFEl ejercicio o la alimentacion afecta positivamente tu humor? \u00BFComo?"]},
  ];

  // ── CATEGORIAS FISICAS (de las imagenes) ──
  const PHYS_CATS=[
    {key:"strength",emoji:"\uD83D\uDCAA",title:"Fuerza fisica",qs:[
      "\u00BFSientes que tu fuerza ha mejorado, empeorado o se mantiene igual respecto a semanas anteriores?",
      "\u00BFEn que ejercicios o movimientos notas mayor o menor fuerza?",
      "\u00BFSientes que tu cuerpo responde bien al entrenamiento de fuerza actualmente?"]},
    {key:"endurance",emoji:"\uD83C\uDFC3",title:"Resistencia fisica",qs:[
      "\u00BFComo esta tu resistencia cardiovascular? \u00BFTe cansas rapido al hacer cardio o ejercicio intenso?",
      "\u00BFCuanto tiempo puedes mantener actividad fisica continua sin sentirte muy fatigado/a?",
      "\u00BFHas notado mejoras o caidas en tu resistencia ultimamente?"]},
    {key:"recovery",emoji:"\uD83D\uDECC",title:"Recuperacion muscular",qs:[
      "\u00BFCuanto tiempo tarda tu cuerpo en recuperarse despues de un entrenamiento intenso?",
      "\u00BFSientes dolor muscular (agujetas) frecuentemente? \u00BFEs normal o excesivo?",
      "\u00BFEstas haciendo algo activo para mejorar la recuperacion (estiramiento, descanso, hidratacion)?"]},
    {key:"pain",emoji:"\uD83D\uDC8A",title:"Dolores y molestias",qs:[
      "\u00BFTienes alguna molestia, dolor articular o muscular que te limite actualmente?",
      "\u00BF Alguna zona de tu cuerpo te duele con frecuencia al entrenar o en el dia a dia?",
      "\u00BFHas tenido lesiones recientes que afecten tu entrenamiento?"]},
  ];

  const cats = phase==="mental"?MENTAL_CATS : phase==="fisica"?PHYS_CATS : [];
  const cat = cats[catIdx];
  const totalCats = cats.length;

  const setA=(qi,val)=>{const k=`${phase}_${cat.key}_${qi}`;setAns(p=>({...p,[k]:val}));};
  const getA=(qi)=>ans[`${phase}_${cat?.key}_${qi}`]||"";

  const startSurvey=()=>{setPhase("mental");setCatIdx(0);setAns({});};

  const nextCat=()=>{
    if(catIdx<totalCats-1){setCatIdx(i=>i+1);window.scrollTo(0,0);}
    else if(phase==="mental"){setPhase("intro_fisica");window.scrollTo(0,0);}
    else if(phase==="fisica"){finish();}
  };
  const prevCat=()=>{
    if(catIdx>0){setCatIdx(i=>i-1);window.scrollTo(0,0);}
    else if(phase==="fisica"){setPhase("mental");setCatIdx(MENTAL_CATS.length-1);window.scrollTo(0,0);}
    else if(phase==="mental"){setPhase(null);}
  };

  const finish=async()=>{
    setScoring(true);
    const result=await genMental(ans);
    const survey={...result,id:"ms_"+Date.now(),month:monthLabel,responses:ans,created_at:Date.now()};
    const updated=[survey,...surveys];
    setSurveys(updated);setMany(uid,"mental_surveys",updated);
    setPhase(null);setCatIdx(0);setAns({});setScoring(false);
  };

  const latest=surveys[0];
  const MK=["energy_level","sleep_quality","stress_level","motivation","mood","anxiety_level","overall_wellbeing"];
  const PK=["physical_strength","physical_endurance","flexibility","pain_level","recovery","appetite"];

  // ════ PANTALLA: encuesta activa (mental o fisica) ════
  if(phase==="mental"||phase==="fisica"){
    const isLastCat=catIdx===totalCats-1;
    const phaseLabel=phase==="mental"?"Mental":"Fisica";
    const totalSteps=phase==="mental"?MENTAL_CATS.length:PHYS_CATS.length;
    return(<div style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,overflowY:"auto"}}>
      <div style={{maxWidth:520,margin:"0 auto",padding:"18px 18px 40px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h2 style={{fontSize:18,fontWeight:800}}>Encuesta de Bienestar {"\u2014"} {monthLabel}</h2>
          <button onClick={()=>setPhase(null)} style={{background:"none",border:"none",color:T.sub,fontSize:22,cursor:"pointer"}}>{"\u00D7"}</button>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.sub,marginBottom:6}}>
          <span>{phaseLabel} {"\u00B7"} {cat.title}</span><span>{catIdx+1}/{totalSteps}</span>
        </div>
        <div style={{height:4,background:T.border,borderRadius:2,marginBottom:18}}>
          <div style={{height:4,background:T.bright,borderRadius:2,width:`${((catIdx+1)/totalSteps)*100}%`,transition:"width .3s"}}/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14,background:T.card,border:`1px solid ${T.border}`,borderRadius:T.rLg,padding:"16px 18px",marginBottom:22}}>
          <span style={{fontSize:26}}>{cat.emoji}</span>
          <div><div style={{fontSize:15,fontWeight:700}}>{cat.title}</div><div style={{fontSize:12,color:T.sub}}>Responde con el mayor detalle posible</div></div>
        </div>
        {cat.qs.map((q,qi)=>(
          <div key={qi} style={{marginBottom:20}}>
            <p style={{fontSize:14,fontWeight:600,marginBottom:8,lineHeight:1.4}}><span style={{color:T.bright}}>{qi+1}.</span> {q}</p>
            <textarea style={{...CC.inp,minHeight:80}} placeholder="Escribe tu respuesta aqui..." value={getA(qi)} onChange={e=>setA(qi,e.target.value)}/>
          </div>
        ))}
        <div style={{display:"flex",gap:10,marginTop:24}}>
          <button onClick={prevCat} style={{width:52,height:50,borderRadius:T.r,background:T.card,border:`1px solid ${T.border}`,color:T.text,fontSize:18,cursor:"pointer",flexShrink:0,fontFamily:"inherit"}}>{"\u2039"}</button>
          <Btn ch={scoring?(<><Spin/>Analizando...</>):isLastCat&&phase==="mental"?(<>Continuar a Fisica {"\u203A"}</>):isLastCat&&phase==="fisica"?(<>{"\u2728"} Analizar con IA</>):(<>Siguiente {"\u203A"}</>)} onClick={nextCat} disabled={scoring} sx={{flex:1}}/>
        </div>
      </div>
    </div>);
  }

  // ════ PANTALLA: intro a la fase fisica ════
  if(phase==="intro_fisica"){
    return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,maxWidth:440,width:"100%",padding:"32px 28px",textAlign:"center"}}>
        <div style={{fontSize:11,color:T.sub,marginBottom:16,textAlign:"left"}}>Encuesta de Bienestar {"\u2014"} {monthLabel}</div>
        <div style={{width:60,height:60,borderRadius:16,background:T.dim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 16px"}}>{"\uD83C\uDFCB\uFE0F"}</div>
        <h2 style={{fontSize:20,fontWeight:800,marginBottom:10}}>Evaluacion Fisica</h2>
        <p style={{fontSize:13,color:T.sub,lineHeight:1.6,marginBottom:8}}>Ahora responde preguntas sobre tu estado fisico: fuerza, resistencia, recuperacion y dolores.</p>
        <p style={{fontSize:12,color:T.dimT,marginBottom:24}}>4 caracteristicas {"\u00B7"} ~12 preguntas</p>
        <div style={{display:"flex",gap:10}}>
          <Btn v="g" ch="Cancelar" onClick={()=>setPhase(null)} sx={{flex:1}}/>
          <Btn ch={<>Comenzar {"\u203A"}</>} onClick={()=>{setPhase("fisica");setCatIdx(0);}} sx={{flex:1}}/>
        </div>
      </div>
    </div>);
  }

  // ════ PANTALLA: dashboard de resultados ════
  return(<div>
    <div style={{padding:"24px 18px 14px"}}><p style={CC.lbl}>BIENESTAR</p><h1 style={{fontSize:26,fontWeight:800,color:T.text}}>Salud Mental</h1></div>
    <div style={{padding:"0 18px 100px"}}>
      <Btn ch="Iniciar encuesta de bienestar mensual" onClick={startSurvey} sx={{marginBottom:16}}/>
      {latest&&(<>
        <div style={CC.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h3 style={{fontSize:14,fontWeight:700,marginBottom:0,textTransform:"capitalize"}}>{latest.month}</h3>
            <Badge ch={`${parseFloat(latest.total_score).toFixed(1)} / 10`}/>
          </div>
          <div style={{display:"flex",justifyContent:"center",marginBottom:12}}><RadarChart mental={MK.map(k=>latest[k]||5)} physical={PK.map(k=>latest[k]||5)} labels={["Energia","Sueno","Estres","Motiv.","Animo","Ansied.","Bienestar"]}/></div>
          <div style={{display:"flex",gap:16,justifyContent:"center",fontSize:11}}>
            <span style={{color:T.bright}}>Mental ({parseFloat(latest.mental_score).toFixed(1)})</span>
            <span style={{color:T.ok}}>Fisico ({parseFloat(latest.physical_score).toFixed(1)})</span>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          {[["Mental",MK,T.bright],["Fisico",PK,T.ok]].map(([title,keys,color])=>(<div key={title} style={{...CC.card,marginBottom:0}}>
            <div style={{fontSize:10,fontWeight:800,color,letterSpacing:".08em",marginBottom:12}}>{title.toUpperCase()}</div>
            {keys.map(k=>(<div key={k} style={{marginBottom:9}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}><span style={{color:T.sub,textTransform:"capitalize"}}>{k.replace(/_/g," ")}</span><span style={{fontWeight:700,...CC.mono}}>{latest[k]}</span></div>
              <div style={{height:2,background:T.border,borderRadius:1}}><div style={{height:2,background:color,borderRadius:1,width:`${(latest[k]/10)*100}%`}}/></div>
            </div>))}
          </div>))}
        </div>
        {latest.insights&&<div style={CC.card}><p style={CC.lbl}>Analisis</p><p style={{fontSize:13,color:T.sub,lineHeight:1.8}}>{latest.insights}</p></div>}
      </>)}
      {!latest&&<p style={{textAlign:"center",padding:"60px 20px",color:T.sub,fontSize:13}}>Completa tu primera encuesta de bienestar</p>}
    </div>
  </div>);
}

function AssistantPage({uid}){
  const[msgs,setMsgs]=useState([{role:"assistant",content:"Hola. Soy tu coach personal de fitness y nutricion. Tengo acceso a tu perfil y planes. En que puedo ayudarte hoy?"}]);
  const[input,setInput]=useState("");
  const[loading,setLoading]=useState(false);
  const[listening,setListening]=useState(false);
  const[recording,setRecording]=useState(false);
  const[recTime,setRecTime]=useState(0);
  const bottomRef=useRef(null);
  const recRef=useRef(null);
  const chunksRef=useRef([]);
  const timerRef=useRef(null);
  const srRef=useRef(null);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);

  const send=async(text)=>{
    const msg=text||input;if(!msg.trim()||loading)return;
    setMsgs(h=>[...h,{role:"user",content:msg}]);setInput("");setLoading(true);
    const reply=await genChat([...msgs,{role:"user",content:msg}],getOne(uid,"profile"));
    setMsgs(h=>[...h,{role:"assistant",content:reply}]);setLoading(false);
  };

  // ── DICTADO (Speech-to-Text) via Web Speech API ──
  const toggleDictation=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){alert("Tu navegador no soporta dictado por voz. Prueba en Chrome.");return;}
    if(listening){srRef.current?.stop();setListening(false);return;}
    const sr=new SR();
    sr.lang="es-ES";sr.interimResults=true;sr.continuous=false;
    sr.onresult=e=>{
      let txt="";
      for(let i=0;i<e.results.length;i++)txt+=e.results[i][0].transcript;
      setInput(txt);
    };
    sr.onend=()=>setListening(false);
    sr.onerror=()=>setListening(false);
    srRef.current=sr;sr.start();setListening(true);
  };

  // ── GRABAR AUDIO (mensaje de voz) ──
  const startRecording=async()=>{
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mr=new MediaRecorder(stream);
      chunksRef.current=[];
      mr.ondataavailable=e=>{if(e.data.size>0)chunksRef.current.push(e.data);};
      mr.onstop=()=>{
        const blob=new Blob(chunksRef.current,{type:"audio/webm"});
        const url=URL.createObjectURL(blob);
        const dur=recTime;
        setMsgs(h=>[...h,{role:"user",type:"audio",audioUrl:url,duration:dur}]);
        stream.getTracks().forEach(t=>t.stop());
        // El bot responde al audio (en produccion: transcribir y procesar)
        setLoading(true);
        genChat([...msgs,{role:"user",content:"[el usuario envio un mensaje de voz]"}],getOne(uid,"profile")).then(reply=>{setMsgs(h=>[...h,{role:"assistant",content:reply}]);setLoading(false);});
      };
      recRef.current=mr;mr.start();setRecording(true);setRecTime(0);
      timerRef.current=setInterval(()=>setRecTime(t=>t+1),1000);
    }catch(err){alert("No se pudo acceder al microfono. Revisa los permisos.");}
  };
  const stopRecording=(cancel)=>{
    clearInterval(timerRef.current);
    if(recRef.current&&recRef.current.state!=="inactive"){
      if(cancel){recRef.current.onstop=()=>{recRef.current.stream?.getTracks().forEach(t=>t.stop());};}
      recRef.current.stop();
    }
    setRecording(false);
  };
  const fmtTime=s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  const SUGG=["Que comer antes de entrenar?","Rutina de espalda en casa","Como mejorar la recuperacion","Cuanta proteina necesito"];

  return(<div className="chat-wrap" style={{display:"flex",flexDirection:"column",position:"relative",minHeight:"100vh"}}>
    <div style={{padding:"24px 18px 14px",flexShrink:0}}><p style={CC.lbl}>ASISTENTE</p><h1 style={{fontSize:26,fontWeight:800,color:T.text}}>Coach IA</h1></div>
    <div style={{flex:1,overflowY:"auto",padding:"0 18px 16px",display:"flex",flexDirection:"column",gap:10}}>
      {msgs.map((m,i)=>(<div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
        {m.type==="audio"?(
          <div style={{maxWidth:"82%",padding:"10px 14px",borderRadius:"14px 14px 3px 14px",background:T.bright,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18}}>{"\uD83C\uDFA4"}</span>
            <audio controls src={m.audioUrl} style={{height:32,maxWidth:160}}/>
            <span style={{fontSize:11,color:"rgba(255,255,255,.8)",...CC.mono}}>{fmtTime(m.duration||0)}</span>
          </div>
        ):(
          <div style={{maxWidth:"82%",padding:"12px 16px",fontSize:14,lineHeight:1.7,whiteSpace:"pre-wrap",borderRadius:m.role==="user"?"14px 14px 3px 14px":"3px 14px 14px 14px",background:m.role==="user"?T.bright:T.card,border:m.role==="user"?"none":`1px solid ${T.border}`,color:T.text}}>{m.content}</div>
        )}
      </div>))}
      {loading&&<div style={{display:"flex",justifyContent:"flex-start"}}><div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:"3px 14px 14px 14px",padding:"12px 18px",display:"flex",gap:5,alignItems:"center"}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:T.sub,animation:`blink 1.2s ${i*.2}s infinite`}}/>)}</div></div>}
      <div ref={bottomRef} style={{height:4}}/>
    </div>
    <div className="chat-input-bar" style={{flexShrink:0,padding:"10px 18px",borderTop:`1px solid ${T.border}`,background:T.surface}}>
      {recording?(
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"6px 4px"}}>
          <div style={{width:10,height:10,borderRadius:"50%",background:T.err,animation:"blink 1s infinite"}}/>
          <span style={{flex:1,fontSize:14,...CC.mono,color:T.text}}>Grabando... {fmtTime(recTime)}</span>
          <button onClick={()=>stopRecording(true)} style={{background:"none",border:`1px solid ${T.border}`,color:T.sub,borderRadius:T.r,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
          <button onClick={()=>stopRecording(false)} style={{background:T.bright,border:"none",color:"#fff",borderRadius:T.r,padding:"8px 16px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Enviar {"\u2192"}</button>
        </div>
      ):(
        <>
          <div style={{display:"flex",gap:5,overflowX:"auto",marginBottom:10,paddingBottom:2}}>{SUGG.map(sg=><button key={sg} onClick={()=>send(sg)} style={{padding:"6px 12px",borderRadius:T.rFull,border:`1px solid ${T.border}`,background:"transparent",color:T.sub,fontSize:11,fontFamily:"inherit",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{sg}</button>)}</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={toggleDictation} title="Dictar por voz" style={{padding:"11px",borderRadius:T.r,background:listening?T.bright:T.card,border:`1px solid ${listening?T.bright:T.border}`,color:listening?"#fff":T.sub,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>
            </button>
            <input style={{...CC.inp,flex:1}} placeholder={listening?"Escuchando...":"Escribe o dicta tu consulta..."} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}/>
            {input.trim()?(
              <button onClick={()=>send()} disabled={loading} style={{padding:"12px 18px",borderRadius:T.r,background:T.bright,border:"none",color:"#fff",fontWeight:700,fontFamily:"inherit",cursor:"pointer",opacity:loading?.4:1,flexShrink:0,fontSize:16}}>{"\u2192"}</button>
            ):(
              <button onClick={startRecording} title="Grabar audio" style={{padding:"11px",borderRadius:T.r,background:T.card,border:`1px solid ${T.border}`,color:T.bright,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  </div>);
}

/* ═══════════ AVATAR ═══════════ */
function Avatar({data,size=44,onClick}){
  const a=data||{bg:"#3457e8",face:"\uD83D\uDE0E"};
  const st={width:size,height:size,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:onClick?"pointer":"default",overflow:"hidden",fontSize:size*0.5};
  if(a.photo) return <img src={a.photo} onClick={onClick} style={{...st,objectFit:"cover"}} alt="avatar"/>;
  return <div onClick={onClick} style={{...st,background:a.bg||"#3457e8",border:`2px solid ${T.border}`}}>{a.face||a.emoji||"\uD83D\uDE42"}</div>;
}

/* ═══════════ AVATAR BUILDER ═══════════ */
function AvatarBuilder({uid,current,onSave,onClose}){
  const[av,setAv]=useState(current||{bg:AV_COLORS[0],face:AV_FACES[0],photo:null});
  const[tab,setTab]=useState(av.photo?"foto":"crear");
  const fileRef=useRef(null);
  const pickPhoto=e=>{
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>setAv({...av,photo:reader.result});
    reader.readAsDataURL(file);
  };
  return(<div className="modal-ov" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal-card" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:"18px 18px 0 0",width:"100%",maxHeight:"88vh",overflowY:"auto",padding:24}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <h2 style={{fontSize:18,fontWeight:800}}>Tu avatar</h2>
        <button onClick={onClose} style={{background:"none",border:"none",color:T.sub,fontSize:22,cursor:"pointer"}}>{"\u00D7"}</button>
      </div>
      <div style={{display:"flex",justifyContent:"center",marginBottom:20}}>
        <Avatar data={av} size={100}/>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        <Chip label="Crear" active={tab==="crear"} onClick={()=>setTab("crear")} sx={{flex:1}}/>
        <Chip label="Subir foto" active={tab==="foto"} onClick={()=>setTab("foto")} sx={{flex:1}}/>
      </div>
      {tab==="crear"?(
        <>
          <p style={CC.lbl}>Personaje</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:20}}>
            {AV_FACES.map(f=><button key={f} onClick={()=>setAv({...av,face:f,photo:null})} style={{aspectRatio:"1",fontSize:24,borderRadius:T.r,border:`2px solid ${av.face===f&&!av.photo?T.bright:T.border}`,background:av.face===f&&!av.photo?T.dim:T.surface,cursor:"pointer"}}>{f}</button>)}
          </div>
          <p style={CC.lbl}>Color de fondo</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:8,marginBottom:24}}>
            {AV_COLORS.map(col=><button key={col} onClick={()=>setAv({...av,bg:col})} style={{aspectRatio:"1",borderRadius:"50%",background:col,border:`3px solid ${av.bg===col?"#fff":"transparent"}`,cursor:"pointer"}}/>)}
          </div>
        </>
      ):(
        <div style={{marginBottom:24}}>
          <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} style={{display:"none"}}/>
          <button onClick={()=>fileRef.current?.click()} style={{width:"100%",padding:"40px 20px",borderRadius:T.rLg,border:`2px dashed ${T.border}`,background:T.surface,color:T.sub,fontSize:14,cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
            <span style={{fontSize:32}}>{"\uD83D\uDCF7"}</span>
            <span>{av.photo?"Cambiar foto":"Toca para subir una foto"}</span>
          </button>
          {av.photo&&<button onClick={()=>setAv({...av,photo:null})} style={{width:"100%",marginTop:10,padding:"10px",borderRadius:T.r,border:`1px solid ${T.border}`,background:"transparent",color:T.err,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Quitar foto</button>}
        </div>
      )}
      <Btn ch="Guardar avatar" onClick={()=>{setOne(uid,"avatar",av);onSave(av);onClose();}}/>
    </div>
  </div>);
}

/* ═══════════ MEDALLA (con animacion de desbloqueo) ═══════════ */
function Medal({mission,unlocked,size=64,animate}){
  const lvl=LEVEL_COLORS[mission.level];
  return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,opacity:unlocked?1:0.35,animation:animate?"medalPop .6s ease both":"none"}}>
    <div style={{width:size,height:size,borderRadius:"50%",background:unlocked?`radial-gradient(circle at 35% 30%, ${lvl.c}, ${lvl.c}99)`:T.card,border:`3px solid ${unlocked?lvl.c:T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.42,boxShadow:unlocked?`0 0 16px ${lvl.g}`:"none",position:"relative"}}>
      {unlocked?mission.icon:"\uD83D\uDD12"}
    </div>
    <span style={{fontSize:9,fontWeight:800,color:unlocked?lvl.c:T.dimT,letterSpacing:".05em"}}>{lvl.label}</span>
  </div>);
}

/* ═══════════ PAGINA: MISIONES ═══════════ */
function MissionsPage({uid}){
  const[claimed,setClaimed]=useState(()=>getOne(uid,"medals")||{});
  const[justUnlocked,setJustUnlocked]=useState(null);
  const claim=(m)=>{
    const updated={...claimed,[m.id]:{...m,unlockedAt:Date.now()}};
    setClaimed(updated);setOne(uid,"medals",updated);
    setJustUnlocked(m.id);
    setTimeout(()=>setJustUnlocked(null),2000);
  };
  const totalMedals=Object.keys(claimed).length;
  return(<div>
    <div style={{padding:"24px 18px 14px"}}><p style={CC.lbl}>SEMANAL</p><h1 style={{fontSize:26,fontWeight:800,color:T.text}}>Misiones</h1></div>
    <div style={{padding:"0 18px 100px"}}>
      <div style={{...CC.card,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div><div style={{fontSize:13,color:T.sub}}>Medallas obtenidas</div><div style={{fontSize:28,fontWeight:900,color:T.bright,...CC.mono}}>{totalMedals}<span style={{fontSize:15,color:T.dimT}}>/{MISSIONS.length}</span></div></div>
        <span style={{fontSize:40}}>{"\uD83C\uDFC5"}</span>
      </div>
      {MISSIONS.map(m=>{
        const prog=missionProgress(uid,m);
        const done=prog>=m.goal;
        const isClaimed=!!claimed[m.id];
        const lvl=LEVEL_COLORS[m.level];
        return(<div key={m.id} style={{...CC.card,display:"flex",alignItems:"center",gap:14,borderColor:isClaimed?lvl.c+"55":T.border}}>
          <Medal mission={m} unlocked={isClaimed} size={56} animate={justUnlocked===m.id}/>
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
              <span style={{fontSize:14,fontWeight:700}}>{m.title}</span>
              <span style={{fontSize:8,fontWeight:800,color:lvl.c,border:`1px solid ${lvl.c}66`,borderRadius:4,padding:"1px 5px"}}>{lvl.label}</span>
            </div>
            <div style={{fontSize:12,color:T.sub,marginBottom:8}}>{m.desc}</div>
            <div style={{height:5,background:T.border,borderRadius:3,overflow:"hidden"}}>
              <div style={{height:5,background:lvl.c,borderRadius:3,width:`${Math.min(100,(prog/m.goal)*100)}%`,transition:"width .4s"}}/>
            </div>
            <div style={{fontSize:10,color:T.dimT,marginTop:4,...CC.mono}}>{Math.min(prog,m.goal)} / {m.goal}</div>
          </div>
          {isClaimed?(
            <span style={{fontSize:11,fontWeight:700,color:T.ok,flexShrink:0}}>{"\u2713"} Obtenida</span>
          ):done?(
            <button onClick={()=>claim(m)} style={{background:lvl.c,color:"#fff",border:"none",borderRadius:T.r,padding:"9px 14px",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"inherit",flexShrink:0,boxShadow:`0 0 14px ${lvl.g}`}}>Reclamar</button>
          ):(
            <span style={{fontSize:11,color:T.dimT,flexShrink:0}}>En curso</span>
          )}
        </div>);
      })}
    </div>
  </div>);
}

/* ═══════════ PAGINA: RANGOS DE FUERZA ═══════════ */
function RanksPage({uid}){
  const profile=getOne(uid,"profile")||{};
  const[weights,setWeights]=useState(()=>getOne(uid,"muscle_weights")||{});
  const bw=parseFloat(profile.weight_kg)||75;
  const sex=profile.sex||"Masculino";
  const age=parseFloat(profile.age)||28;
  const save=(k,v)=>{const u={...weights,[k]:parseFloat(v)||0};setWeights(u);setOne(uid,"muscle_weights",u);};
  return(<div>
    <div style={{padding:"24px 18px 14px"}}><p style={CC.lbl}>FUERZA</p><h1 style={{fontSize:26,fontWeight:800,color:T.text}}>Mis Rangos</h1></div>
    <div style={{padding:"0 18px 100px"}}>
      <div style={{...CC.card,fontSize:12,color:T.sub,lineHeight:1.6}}>
        Tu rango se calcula segun el peso que levantas en relacion a tu peso corporal ({bw}kg), tu sexo y tu edad ({age} anos). Asi es justo para cada persona. Ingresa tu mejor levantamiento en cada ejercicio.
      </div>
      {MUSCLES.map(m=>{
        const w=weights[m.key]||"";
        const rank=rankFor(m.key,parseFloat(w),bw,sex,age);
        const af=ageFactor(age);
        const ratios=(sex==="Femenino"?RATIOS_F:RATIOS_M)[m.key];
        const nextKg=rank.idx>=0&&rank.idx<RANKS.length-1?Math.round(ratios[rank.idx+1]*af*bw):null;
        return(<div key={m.key} style={CC.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{fontSize:15,fontWeight:700}}>{m.label}</div>
              <div style={{fontSize:11,color:T.sub}}>{m.ex}</div>
            </div>
            {rank.idx>=0?(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
                <div style={{width:46,height:46,borderRadius:"50%",background:`radial-gradient(circle at 35% 30%,${rank.color},${rank.color}99)`,border:`2px solid ${rank.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:`0 0 14px ${rank.glow}`}}>{m.icon}</div>
                <span style={{fontSize:10,fontWeight:800,color:rank.color,marginTop:3}}>{rank.name.toUpperCase()}</span>
              </div>
            ):(
              <span style={{fontSize:11,color:T.dimT}}>Sin datos</span>
            )}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input style={{...CC.inp,flex:1}} type="number" placeholder="Peso maximo (kg)" value={w} onChange={e=>save(m.key,e.target.value)}/>
            <span style={{fontSize:12,color:T.sub,...CC.mono,whiteSpace:"nowrap"}}>x{w&&bw?(parseFloat(w)/bw).toFixed(2):"0.00"} PC</span>
          </div>
          {nextKg&&<div style={{fontSize:10,color:T.dimT,marginTop:8}}>Proximo rango ({RANKS[rank.idx+1].name}) a {nextKg}kg</div>}
          {/* barra de rangos */}
          <div style={{display:"flex",gap:2,marginTop:10}}>
            {RANKS.map((r,i)=><div key={i} style={{flex:1,height:4,borderRadius:2,background:rank.idx>=i?r.color:T.border}} title={r.name}/>)}
          </div>
        </div>);
      })}
    </div>
  </div>);
}

/* ═══════════ PAGINA: SOCIAL (Amigos + Clan) ═══════════ */
function SocialPage({uid,user}){
  const[tab,setTab]=useState("amigos");
  const[avatar,setAvatar]=useState(()=>getOne(uid,"avatar"));
  const[showBuilder,setShowBuilder]=useState(false);
  const[viewFriend,setViewFriend]=useState(null);
  const[friends,setFriends]=useState([]);
  const[clan,setClan]=useState(null);
  const[clans,setClans]=useState([]);
  const[search,setSearch]=useState("");
  const[results,setResults]=useState([]);
  const[newClan,setNewClan]=useState("");
  const[loading,setLoading]=useState(true);

  const profile=getOne(uid,"profile")||{};
  const bw=parseFloat(profile.weight_kg)||75;
  const sex=profile.sex||"Masculino";
  const age=parseFloat(profile.age)||28;
  const weights=getOne(uid,"muscle_weights")||{};
  const medals=getOne(uid,"medals")||{};

  const myRanks={};
  MUSCLES.forEach(m=>{const r=rankFor(m.key,weights[m.key],bw,sex,age);myRanks[m.key]=r.idx;});

  const refresh=async()=>{
    try{
      const[fr,cl,cls]=await Promise.all([API.getFriends(),API.getClan(),API.getClans()]);
      setFriends(fr||[]);setClan(cl);setClans(cls||[]);
    }catch(e){console.warn(e);}
    setLoading(false);
  };
  useEffect(()=>{refresh();},[]);

  const doSearch=async(q)=>{
    setSearch(q);
    if(q.trim().length<2){setResults([]);return;}
    try{setResults(await API.searchUsers(q));}catch{setResults([]);}
  };
  const addF=async(id)=>{ await API.addFriend(id); setSearch("");setResults([]); refresh(); };
  const removeF=async(id)=>{ await API.removeFriend(id); refresh(); };
  const createC=async()=>{ if(!newClan.trim())return; try{await API.createClan(newClan);setNewClan("");refresh();}catch(e){alert(e.message);} };
  const joinC=async(id)=>{ await API.joinClan(id); refresh(); };
  const leaveC=async()=>{ await API.leaveClan(); refresh(); };

  return(<div>
    <div style={{padding:"24px 18px 14px"}}><p style={CC.lbl}>COMUNIDAD</p><h1 style={{fontSize:26,fontWeight:800,color:T.text}}>Social</h1></div>
    <div style={{padding:"0 18px 100px"}}>
      <div style={{...CC.card,display:"flex",alignItems:"center",gap:14}}>
        <Avatar data={avatar} size={60} onClick={()=>setShowBuilder(true)}/>
        <div style={{flex:1}}>
          <div style={{fontSize:16,fontWeight:800}}>{user.name}</div>
          <div style={{fontSize:12,color:T.sub}}>{clan?`Clan ${clan.name}`:"Sin clan"} {"\u00B7"} {Object.keys(medals).length} medallas</div>
        </div>
        <button onClick={()=>setShowBuilder(true)} style={{background:T.dim,color:T.bright,border:`1px solid rgba(52,87,232,.3)`,borderRadius:T.r,padding:"8px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Editar</button>
      </div>
      {Object.keys(medals).length>0&&(
        <div style={CC.card}>
          <p style={CC.lbl}>Mis medallas</p>
          <div style={{display:"flex",gap:14,flexWrap:"wrap",marginTop:6}}>{Object.values(medals).map(m=><Medal key={m.id} mission={m} unlocked={true} size={48}/>)}</div>
        </div>
      )}
      <div style={{display:"flex",gap:8,margin:"4px 0 14px"}}>
        <Chip label="Amigos" active={tab==="amigos"} onClick={()=>setTab("amigos")} sx={{flex:1}}/>
        <Chip label="Clan" active={tab==="clan"} onClick={()=>setTab("clan")} sx={{flex:1}}/>
      </div>

      {tab==="amigos"?(
        <>
          <div style={{marginBottom:14}}>
            <input style={CC.inp} placeholder="Buscar usuarios por nombre..." value={search} onChange={e=>doSearch(e.target.value)}/>
            {results.length>0&&(
              <div style={{...CC.card,marginTop:8}}>
                {results.map(r=>(
                  <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0"}}>
                    <Avatar data={null} size={36}/>
                    <span style={{flex:1,fontSize:13,fontWeight:600}}>{r.name}</span>
                    <button onClick={()=>addF(r.id)} style={{background:T.bright,color:"#fff",border:"none",borderRadius:T.r,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Anadir</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p style={{...CC.lbl,marginBottom:10}}>Tus amigos ({friends.length})</p>
          {loading?<div style={{textAlign:"center",padding:30}}><Spin/></div>:friends.length===0?(
            <p style={{textAlign:"center",padding:"40px 20px",color:T.sub,fontSize:13}}>Aun no tienes amigos. Busca usuarios arriba para anadirlos.</p>
          ):friends.map(f=>(
            <div key={f.id} style={{...CC.card,display:"flex",alignItems:"center",gap:12}}>
              <Avatar data={f.avatar} size={44} onClick={()=>setViewFriend(f)}/>
              <div style={{flex:1,cursor:"pointer"}} onClick={()=>setViewFriend(f)}>
                <div style={{fontSize:14,fontWeight:700}}>{f.name}</div>
                <div style={{fontSize:11,color:T.sub}}>Nivel {f.level} {"\u00B7"} {f.clan||"Sin clan"}</div>
              </div>
              <button onClick={()=>removeF(f.id)} style={{background:"none",border:"none",color:T.dimT,fontSize:18,cursor:"pointer"}} title="Eliminar">{"\u00D7"}</button>
            </div>
          ))}
        </>
      ):(
        <>
          {clan?(
            <>
              <div style={{...CC.card,textAlign:"center"}}>
                <div style={{fontSize:40,marginBottom:8}}>{"\u2694\uFE0F"}</div>
                <div style={{fontSize:20,fontWeight:800}}>Clan {clan.name}</div>
                <div style={{fontSize:12,color:T.sub,marginTop:4}}>{clan.members.length} miembros</div>
              </div>
              <p style={{...CC.lbl,marginBottom:10}}>Ranking de fuerza por musculo</p>
              {MUSCLES.map(m=>{
                const members=clan.members.map(mem=>{
                  const isMe=mem.id===uid;
                  const w=isMe?weights:(mem.muscle_weights||{});
                  const mbw=parseFloat(mem.profile?.weight_kg)||75;
                  const msex=mem.profile?.sex||"Masculino";
                  const mage=parseFloat(mem.profile?.age)||28;
                  const r=rankFor(m.key,w[m.key],mbw,msex,mage);
                  return{name:mem.name,rankIdx:r.idx,me:isMe};
                });
                members.sort((a,b)=>b.rankIdx-a.rankIdx);
                return(<div key={m.key} style={CC.card}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <span style={{fontSize:16}}>{m.icon}</span><span style={{fontSize:13,fontWeight:700}}>{m.label}</span><span style={{fontSize:10,color:T.dimT}}>{m.ex}</span>
                  </div>
                  {members.map((mem,i)=>{const rk=mem.rankIdx>=0?RANKS[mem.rankIdx]:{name:"Sin datos",color:T.dimT};return(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:i<members.length-1?`1px solid ${T.border}`:"none"}}>
                      <span style={{fontSize:12,fontWeight:800,color:i===0?"#eab308":T.dimT,width:18,...CC.mono}}>{i+1}</span>
                      <span style={{flex:1,fontSize:13,fontWeight:mem.me?700:500,color:mem.me?T.bright:T.text}}>{mem.name}{mem.me?" (tu)":""}</span>
                      <span style={{fontSize:11,fontWeight:700,color:rk.color}}>{rk.name}</span>
                    </div>);})}
                </div>);
              })}
              <Btn v="g" ch="Salir del clan" onClick={leaveC}/>
            </>
          ):(
            <>
              <div style={{...CC.card}}>
                <p style={CC.lbl}>Crear un clan nuevo</p>
                <div style={{display:"flex",gap:8}}>
                  <input style={{...CC.inp,flex:1}} placeholder="Nombre del clan" value={newClan} onChange={e=>setNewClan(e.target.value)}/>
                  <Btn ch="Crear" onClick={createC} sx={{width:"auto"}}/>
                </div>
              </div>
              <p style={{...CC.lbl,marginBottom:10}}>Clanes disponibles</p>
              {clans.length===0?<p style={{textAlign:"center",padding:"30px 20px",color:T.sub,fontSize:13}}>No hay clanes todavia. Crea el primero.</p>:clans.map(c=>(
                <div key={c.id} style={{...CC.card,display:"flex",alignItems:"center",gap:12}}>
                  <span style={{fontSize:24}}>{"\u2694\uFE0F"}</span>
                  <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700}}>{c.name}</div><div style={{fontSize:11,color:T.sub}}>{c.count} miembros</div></div>
                  <Btn ch="Unirme" onClick={()=>joinC(c.id)} sx={{width:"auto"}} sm/>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>

    {showBuilder&&<AvatarBuilder uid={uid} current={avatar} onSave={setAvatar} onClose={()=>setShowBuilder(false)}/>}
    {viewFriend&&(
      <div className="modal-ov" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)setViewFriend(null);}}>
        <div className="modal-card" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:"18px 18px 0 0",width:"100%",padding:24,maxHeight:"85vh",overflowY:"auto"}}>
          <div style={{display:"flex",justifyContent:"flex-end"}}><button onClick={()=>setViewFriend(null)} style={{background:"none",border:"none",color:T.sub,fontSize:22,cursor:"pointer"}}>{"\u00D7"}</button></div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,marginBottom:20}}>
            <Avatar data={viewFriend.avatar} size={80}/>
            <div style={{fontSize:20,fontWeight:800}}>{viewFriend.name}</div>
            <div style={{fontSize:13,color:T.sub}}>Nivel {viewFriend.level} {"\u00B7"} {viewFriend.clan||"Sin clan"}</div>
          </div>
          <p style={CC.lbl}>Rangos de fuerza</p>
          {MUSCLES.map(m=>{
            const fbw=parseFloat(viewFriend.profile?.weight_kg)||75;
            const fsex=viewFriend.profile?.sex||"Masculino";
            const fage=parseFloat(viewFriend.profile?.age)||28;
            const r=rankFor(m.key,(viewFriend.muscle_weights||{})[m.key],fbw,fsex,fage);
            const rk=r.idx>=0?RANKS[r.idx]:{name:"Sin datos",color:T.dimT};
            return(<div key={m.key} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:`1px solid ${T.border}`}}>
              <span style={{fontSize:16}}>{m.icon}</span><span style={{flex:1,fontSize:13,fontWeight:600}}>{m.label}</span><span style={{fontSize:12,fontWeight:700,color:rk.color}}>{rk.name}</span>
            </div>);
          })}
        </div>
      </div>
    )}
  </div>);
}

function ProfilePage({uid,user,onLogout}){
  const[profile,setProfile]=useState(()=>getOne(uid,"profile")||{});
  const[saved,setSaved]=useState(false);
  const[goalChanged,setGoalChanged]=useState(false);
  const GOALS=["Hipertrofia","Perdida de grasa","Fuerza maxima","Resistencia","Ganar velocidad","Bienestar general"];
  const LEVELS=["Sedentario","Ligeramente activo","Moderadamente activo","Muy activo"];
  const origGoal=getOne(uid,"profile")?.fitness_goal;
  const pickGoal=(g)=>{setProfile({...profile,fitness_goal:g,custom_goal:g==="OTRO"?(profile.custom_goal||""):""});setGoalChanged(g!==origGoal);};
  const save=()=>{
    const h=parseFloat(profile.height_cm||175)/100,w=parseFloat(profile.weight_kg||75);const bmi=(w/(h*h)).toFixed(1);
    const finalGoal=profile.fitness_goal==="OTRO"?(profile.custom_goal||"Bienestar general"):profile.fitness_goal;
    const p={...profile,fitness_goal:finalGoal,bmi,created_at:profile.created_at||Date.now()};
    setOne(uid,"profile",p);setProfile(p);setSaved(true);setTimeout(()=>setSaved(false),2000);
  };
  const bmi=profile.bmi?parseFloat(profile.bmi):null;
  const[bLabel,bColor]=bmi?bmiCat(bmi):["—",T.sub];
  return(<div>
    <div style={{padding:"24px 18px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div><p style={CC.lbl}>CUENTA</p><h1 style={{fontSize:24,fontWeight:800,color:T.text}}>{user.name}</h1><p style={{fontSize:12,color:T.sub,marginTop:4}}>{user.email}</p></div>
      <div style={{width:48,height:48,borderRadius:"50%",background:T.dim,border:`1px solid rgba(61,32,255,.4)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:800,color:T.bright}}>{user.name?.[0]?.toUpperCase()}</div>
    </div>
    <div style={{padding:"0 18px 100px"}}>
      {bmi&&<div style={{...CC.card,borderColor:bColor+"50",marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><p style={CC.lbl}>IMC</p><div style={{fontSize:34,fontWeight:900,...CC.mono}}>{bmi}</div></div><Badge ch={bLabel} color={bColor}/></div></div>}
      <div style={CC.card}><h3 style={{fontSize:14,fontWeight:700,marginBottom:14}}>Datos fisicos</h3>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {[["height_cm","Altura (cm)","175"],["weight_kg","Peso (kg)","75"],["age","Edad","28"]].map(([k,l,p])=>(<div key={k}><label style={CC.lbl}>{l}</label><input style={CC.inp} type="number" placeholder={p} value={profile[k]||""} onChange={e=>setProfile({...profile,[k]:e.target.value})}/></div>))}
          <div><label style={CC.lbl}>Sexo biologico</label><div style={{display:"flex",gap:8}}>{["Masculino","Femenino"].map(sx=><Chip key={sx} label={sx} active={profile.sex===sx} onClick={()=>setProfile({...profile,sex:sx})} sx={{flex:1}}/>)}</div></div>
        </div>
      </div>
      <div style={CC.card}><h3 style={{fontSize:14,fontWeight:700,marginBottom:12}}>Objetivo</h3><div style={{display:"flex",flexDirection:"column",gap:7}}>{GOALS.map(g=><Chip key={g} label={g} active={profile.fitness_goal===g} onClick={()=>pickGoal(g)} sx={{justifyContent:"flex-start",borderRadius:T.r}}/>)}
        <Chip label="✏️ Otro objetivo (escribir)" active={profile.fitness_goal==="OTRO"||(profile.fitness_goal&&!GOALS.includes(profile.fitness_goal))} onClick={()=>pickGoal("OTRO")} sx={{justifyContent:"flex-start",borderRadius:T.r}}/>
        {(profile.fitness_goal==="OTRO"||(profile.fitness_goal&&!GOALS.includes(profile.fitness_goal)&&profile.fitness_goal!=="OTRO"))&&(
          <input style={{...CC.inp,marginTop:4}} placeholder="Escribe tu objetivo (ej: preparar una maraton)" value={profile.fitness_goal==="OTRO"?(profile.custom_goal||""):(profile.custom_goal||profile.fitness_goal||"")} onChange={e=>setProfile({...profile,fitness_goal:"OTRO",custom_goal:e.target.value})}/>
        )}
        {goalChanged&&<p style={{fontSize:11,color:T.warn,marginTop:6,lineHeight:1.5}}>{"⚠️"} Cambiaste tu objetivo. Guarda y luego ve a "Rutina" para generar un nuevo plan acorde.</p>}
        </div></div>
      <div style={CC.card}><h3 style={{fontSize:14,fontWeight:700,marginBottom:12}}>Nivel de actividad</h3><div style={{display:"flex",flexDirection:"column",gap:7}}>{LEVELS.map(l=><Chip key={l} label={l} active={profile.activity_level===l} onClick={()=>setProfile({...profile,activity_level:l})} sx={{justifyContent:"flex-start",borderRadius:T.r}}/>)}</div></div>
      <Btn ch={saved?"Guardado":"Guardar cambios"} onClick={save} sx={{marginBottom:10}} v={saved?"o":"p"}/>
      <Btn ch="Cerrar sesion" v="g" onClick={onLogout}/>
      <div style={{height:20}}/>
    </div>
  </div>);
}

function App(){
  const[user,setUser]=useState(null);
  const[page,setPage]=useState("dashboard");
  const[booting,setBooting]=useState(true);

  // Al cargar: si hay token guardado, restaurar sesion
  useEffect(()=>{
    const token=API.getToken();
    if(!token){setBooting(false);return;}
    (async()=>{
      try{
        // Validar token cargando el perfil; si falla, limpiar sesion
        const prof=await API.getProfile();
        // Necesitamos el uid: lo obtenemos de un endpoint ligero reutilizando friends (devuelve 401 si invalido)
        // Mejor: guardamos el user en localStorage tambien para el arranque
        const saved=JSON.parse(localStorage.getItem("ff_user")||"null");
        if(saved){ await loadUserData(saved.uid); setUser(saved); }
        else API.clearToken();
      }catch(e){ API.clearToken(); localStorage.removeItem("ff_user"); }
      setBooting(false);
    })();
  },[]);

  const handleLogin=(u)=>{ localStorage.setItem("ff_user",JSON.stringify(u)); setUser(u); setPage("dashboard"); };
  const handleLogout=async()=>{ await API.apiLogout(); API.clearToken(); localStorage.removeItem("ff_user"); setUser(null); };

  if(booting) return <div className="app-shell" style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}><Spin/></div>;
  if(!user)return(<div className="app-shell"><AuthPage onLogin={handleLogin}/></div>);
  return(<div className="app-shell">
    <SideBar page={page} setPage={setPage}/>
    <div className="main-content">
      {page==="dashboard"&&<Dashboard uid={user.uid} user={user} setPage={setPage}/>}
      {page==="workout"&&<WorkoutPage uid={user.uid}/>}
      {page==="meal"&&<MealPage uid={user.uid}/>}
      {page==="progress"&&<ProgressPage uid={user.uid}/>}
      {page==="mental"&&<MentalPage uid={user.uid}/>}
      {page==="missions"&&<MissionsPage uid={user.uid}/>}
      {page==="ranks"&&<RanksPage uid={user.uid}/>}
      {page==="social"&&<SocialPage uid={user.uid} user={user}/>}
      {page==="assistant"&&<AssistantPage uid={user.uid}/>}
      {page==="profile"&&<ProfilePage uid={user.uid} user={user} onLogout={handleLogout}/>}
    </div>
    <NavBar page={page} setPage={setPage}/>
  </div>);
}

export default App;
