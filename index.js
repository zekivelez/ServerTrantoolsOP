const express = require('express'); //framework Express
const bodyParser = require('body-parser');
const fs = require('fs');
const axios = require('axios'); //Librería Axios
const { jsPDF } = require('jspdf'); //Librería JSPDF
require('jspdf-autotable'); // Plugin autotable
const imagenes = require('./imagenes.js'); // Importación en CommonJS

const app = express();
const port = process.env.PORT || 4000;

app.use(bodyParser.json());

//Muestra la página de incio de la aplicación Express
app.get("/", (req, res) => {
  res.send("La página de inicio");
});
//Método principal que permite crear toda la comunicación con
//la API de Monday.com  y los webhooks.
app.post("/", async (req, res) => {
  const payload = req.body;
  //console.log(req.body);
  //Este if permite ver si tenemos control de nuestra aplicación para responder el desafío
  if (payload && payload.challenge) {
    // Verificación del desafío
    console.log('Received challenge:', payload.challenge);
    const challengeResponse = { challenge: payload.challenge };
    res.status(200).json(challengeResponse);
  } else if (payload && payload.event) {
    // Una vez corroborado el desafío corresponde el Procesamiento de eventos
    const { pulseId, pulseName, type, columnTitle, value, boardId, groupId } = payload.event;
    console.log(value);
    try {
      if (type === "update_column_value" && value.label.text === "Obtener OP") {
        //console.log(pulseId);
        //Paso 1: Obtenemos los datos de la OP.
        const datosOP = await getCharacteristicsOP(pulseId);
        //console.log(datosOP);
        const ordenProduccion = datosOP[0].name;
        const producto = datosOP[0].column_values;
        const idProducto = producto.find(item => item.id === 'reflejo0').display_value;
        //Paso 2: Este método nos permite obtener los kits empleados para este proyecto.
        const kitsProducto = await getSubitemsKits(parseInt(idProducto));
        //Paso 3: Mandamos a generar el docuemnto PDF con los datos necesarios
        const pdfBase64 = await obtenerDocumentoOP(datosOP, kitsProducto);
        // Asignar el nombre al PDF
        const nombreArchivo = ordenProduccion;
        console.log(nombreArchivo);
        //Paso 4: Subir documento PDF a monday.com
        await subirArchivoAMonday(parseInt(pulseId), pdfBase64, nombreArchivo);

      } else if (type === "update_column_value" && value.label.text === "Obtener Lista") {
        //1.- Duplicar listas tanto de materiales como de paquetes7
        const idBoardList = await createBoard(pulseName);
        //console.log(idBoardList);
        const idBoardWareHouse = await createBoardWareHouse(pulseName);
        //2.-Cambiar la descripción de ambas listas, agregarndo el id de la op
        await updateDescriptionBoard(idBoardList, pulseId);
        await updateDescriptionBoard(idBoardWareHouse, pulseId);
        //3.-Colocar los links en el tablero
        await agregarIdBoardInOp(boardId, pulseId, idBoardList, pulseName, idBoardWareHouse)
          .then(() => {
            console.log("ID agregado con éxito.");
          })
          .catch((error) => {
            console.error("Error:", error.message);
          });
        //4.- Métodos para obtener la lista de materiales y la lista de paquetes
        const datosOP = await getCharacteristicsOP(pulseId);
        const producto = datosOP[0].column_values;
        const idProducto = producto.find(item => item.id === 'reflejo0').display_value;
        const unidadesFabricar = parseInt(datosOP[0].column_values.find(item => item.id === 'n_meros3').text);
        const kits = await getSubitemsIds(idProducto);
        const responseList = await processKits(idBoardList, kits, unidadesFabricar);
        //console.log(responseList);
        //5.- Registrar articulos en la lista de materiales y de kits
        const allKits = await getKits(idProducto);
        //console.log(kits);
        const responseWareHouse = await registrarKitsAlmacen(idBoardWareHouse, allKits, 1, pulseId);
        //console.log(responseWareHouse);
      }
      //Si ocurre un error la estructura de control lo atrapa y lo imprime en consola. 
    } catch (error) {
      console.error('Ocurrió un error:', error);
    }
    res.status(200).send('Event processed');
  } else {
    // Si no es un desafío ni un evento válido, regresa un error
    res.status(400).send('Invalid payload');
  }
});
//Método que permite crear un tablero con la lista de materiales
async function createBoard(pulseName) {
  //console.log(pulseName);
  const query = `mutation {
    duplicate_board(board_id: 5124955497, board_name: "${pulseName}", duplicate_type: duplicate_board_with_structure, folder_id: 12148836, keep_subscribers: true) { board { id }}
  }`;
  const version = '2026-01';
  const response = await sendMondayApiRequest(query, version);
  //console.log(response.data);
  return parseInt(response.data.data.duplicate_board.board.id);
}
//Método que permite crear un tablero de Paquetes en el área de almacen
async function createBoardWareHouse(pulseName) {
  const query = `mutation {
    duplicate_board(board_id: 5407757993, board_name: "${pulseName}", duplicate_type: duplicate_board_with_structure, folder_id: 11864035, keep_subscribers: true) { board { id }}
  }`;
  const version = '2026-01';
  const response = await sendMondayApiRequest(query, version);
  return parseInt(response.data.data.duplicate_board.board.id);
}
//Método que actualiza la descripción de la lista de materiales - ID de OP (Contrataciones)
async function updateDescriptionBoard(idBoard, idOP) {
  const query = `mutation {
    update_board(board_id: ${idBoard}, board_attribute: description, new_value: "${idOP}") 
  }`;
  const version = '2026-01';

  try {
    await sendMondayApiRequest(query, version);
  } catch (error) {
    console.error("Error updating the board description:", error);
  }
}

//Método que permite agregar el id del tablero de lista de materiales y el enlace hacia ese tablero en el tablero contrataciones
async function agregarIdBoardInOp(boardId, itemId, id, name, idAlmacen) {
  const board_id = boardId;
  const item_id = parseInt(itemId);
  const columnValues = {
    n_meros0: id,
    enlace: { url: "https://transtools-team.monday.com/boards/" + id, text: name },
    n_meros5: idAlmacen,
    enlace9: { url: "https://transtools-team.monday.com/boards/" + idAlmacen, text: name },
  };
  // Convertir el objeto a una cadena JSON escapando las comillas dobles
  const columnValuesJSON = JSON.stringify(columnValues).replace(/"/g, '\\"');
  const query = `mutation {
    change_multiple_column_values(item_id: ${item_id}, board_id: ${board_id}, column_values: "${columnValuesJSON}") { id }
  }`;
  const version = '2026-01';

  try {
    await sendMondayApiRequest(query, version);
    // No devolver nada en caso de éxito
  } catch (error) {
    // Lanzar el error para que el llamador pueda manejarlo
    throw new Error(`Error al agregar el ID del tablero en OP: ${error.message}`);
  }
}
//Método que permite obtener los subelementos del Producto (Kits)
async function getSubitemsIds(pulseId) {
  const query = `query {
    items(ids: ${JSON.stringify([pulseId]).replace(/"/g, "")}) {
      subitems {               
        id
        column_values (ids: ["reflejo5","n_meros", "reflejo7"]){
          id
          text
          ...on MirrorValue {
            display_value
          }
        }
      }
    }
  }`;
  const version = '2026-01';
  const response = await sendMondayApiRequest(query, version);

  if (response.data && Array.isArray(response.data.data.items)) {
    const kits = [];
    for (const item of response.data.data.items) {
      for (const subitem of item.subitems) {
        // Procesa los subitems aquí
        const idKit = subitem.column_values.find(column => column.id === "reflejo5");
        const cantidadKit = subitem.column_values.find(column => column.id === "n_meros");
        const codigo = subitem.column_values.find(column => column.id === "reflejo7");
        if (idKit && idKit.display_value != "" && cantidadKit) {
          kits.push({
            id: idKit.display_value,
            cantidad: cantidadKit.text,
            codigo: codigo.display_value
          });
        }
      }
    }
    return kits;
  } else {
    throw new Error("El array 'items' está vacío o hay un error en la respuesta JSON.");
  }
}
//Método para obtener los Kits del producto con características especificas para el almacen
async function getKits(pulseId) {
  const query = `query {
    items(ids: ${JSON.stringify([pulseId]).replace(/"/g, "")}) {
      subitems {
        name
        column_values(ids: ["conectar_tableros", "n_meros","reflejo5"]) {
          id
          text
          ...on MirrorValue {
            display_value
          }
          ...on BoardRelationValue {
            display_value
          }
        }
      }
    }
  }`;
  const version = '2026-01';
  const response = await sendMondayApiRequest(query, version);
  if (response.data && Array.isArray(response.data.data.items)) {
    const kitsOrdenados = [];
    for (const item of response.data.data.items) {
      const subitems = item.subitems;
      // Verifica si hay subitems antes de procesarlos
      if (subitems) {
        for (const subitem of subitems) {

          const configuracion = subitem.name;
          const nombreKit = subitem.column_values.find(column => column.id === "conectar_tableros");
          const cantidad = subitem.column_values.find(column => column.id === "n_meros");
          const id = subitem.column_values.find(column => column.id === "reflejo5");

          //Reestructuración de arreglo articulos.
          kitsOrdenados.push({
            configuracion: configuracion,
            nombreKit: nombreKit.display_value,
            cantidad: cantidad.text !== "" ? cantidad.text : 0,
            id: id.display_value
          });
        }
      }
    }

    return kitsOrdenados;
  }
}
//Método que permite registrar (Procesar) los kits por lotes
async function processKits(tableroId, kits, cantidadProducto) {
  // REPLÁZALA POR ESTA:
  const articulosArrays = [];
  for (const kit of kits) {
    try {
      const itemId = kit.id;
      const cantidad = parseFloat(kit.cantidad);
      const codigoKit = kit.codigo;
      // Ejecución secuencial (uno por uno)
      const articulos = await fetchSubitems(itemId, cantidad, codigoKit, cantidadProducto);
      articulosArrays.push(articulos);

      // Espera 200ms entre kits para evitar saturar la API
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`Error procesando kit ${kit.id}:`, error.message);
    }
  }
  const articulos = articulosArrays.flat(); // Combina todos los arrays en uno solo
  const articulosCombinados = {};

  for (const articulo of articulos) {
    const key = articulo.articulo;  // Usar el nombre del artículo como clave

    if (articulosCombinados[key]) {
      // Si el artículo ya existe, suma la cantidad y concatena los procesos y códigos de kit
      //Cantidad x Unidad
      articulosCombinados[key].cantidadUnidad += articulo.cantidadUnidad;
      //Cantidad total por número de unidades
      articulosCombinados[key].cantidad += articulo.cantidad;
      articulosCombinados[key].proceso += `, ${articulo.proceso}`;
      articulosCombinados[key].codigoKit += `, ${articulo.codigoKit}`;
    } else {
      // Si no existe, crea un nuevo artículo
      articulosCombinados[key] = {
        ...articulo,
        //cantidadUnidad: 0,  // Puedes ajustar este valor según tu lógica
      };
    }
  }
  //Obtenemos el arreglo de todos los articulos
  const articulosFinal = Object.values(articulosCombinados);
  const uniqueProviders = obtenerProveedoresUnicos(articulosFinal); // Implementa esta función para obtener proveedores únicos.
  // Obtener la lista de grupos existentes
  const existingGroups = await obtenerGruposExistentes(tableroId);
  // Iterar sobre los proveedores únicos y crear grupos si no existen
  for (const proveedor of uniqueProviders) {
    const grupoExistente = existingGroups.find(group => group.title === proveedor);
    if (!grupoExistente) {
      await crearGrupo(tableroId, proveedor);
    }
  }
  // Método empleado para registar los articulos en el tablero lista de materiales en el grupo proveedor sugerido correspondiente.
  await registrarArticulosEnTablero(tableroId, articulosFinal);
  return articulosFinal;
}
//Método que permite obtener los articulos de cada Kit.
async function fetchSubitems(itemId, cantidad, codigoKit, cantidadProducto) {
  const query = `query {
    items(ids: ${itemId}) {
      subitems {
        column_values(ids:["conectar_tableros1", "texto", "reflejo76", "reflejo5", "reflejo0", "n_meros", "reflejo7",  "reflejo_1", "reflejo69", "reflejo52"]){
          id
          text
          ...on MirrorValue {
            display_value
          }
          ...on BoardRelationValue {
            display_value
          }
        }
      }
    }
  }`;
  const version = '2026-01';
  const response = await sendMondayApiRequest(query, version);
  if (response.data && Array.isArray(response.data.data.items)) {
    const articulosMultiplicados = [];
    for (const item of response.data.data.items) {
      // VALIDACIÓN DE SEGURIDAD: Si el item es null, lo saltamos
      if (!item) {
        console.warn("Aviso: Un ítem regresó como null desde Monday (Posible retraso).");
        continue;
      }

      const subitems = item.subitems;
      if (subitems) {
        for (const subitem of subitems) {
          // También validamos que existan column_values
          if (!subitem.column_values) continue;
          // Procesa los subitems aquí
          const articuloNombre = subitem.column_values.find(column => column.id === "conectar_tableros1");
          const proceso = subitem.column_values.find(column => column.id === "texto");
          const codigoMarca = subitem.column_values.find(column => column.id === "reflejo76");
          const codigoInterno = subitem.column_values.find(column => column.id === "reflejo5");
          const familia = subitem.column_values.find(column => column.id === "reflejo0");
          const cantidadArticulo = subitem.column_values.find(column => column.id === "n_meros");
          const precio = subitem.column_values.find(column => column.id === "reflejo_1");
          const unidadMedida = subitem.column_values.find(column => column.id === "reflejo7");
          const idProveedor = subitem.column_values.find(column => column.id === "reflejo69");
          const proveedor = subitem.column_values.find(column => column.id === "reflejo52");
          if (articuloNombre && cantidadArticulo && precio) {
            var cantidadTotal = parseFloat(cantidadArticulo.text) * cantidad * cantidadProducto;
            var cantidadUnidad = parseFloat(cantidadArticulo.text) * cantidad;
            var precioNeto = parseFloat(precio.display_value) * 1.16;
            // Verifica si precio es un número válido, si no, establece su valor en cero
            if (isNaN(cantidadTotal)) {
              cantidadTotal = 0;
            }
            // Verifica si cantidad es un número válido, si no, establece su valor en cero
            if (isNaN(precioNeto)) {
              precioNeto = 0;
            }
            // Verifica si articuloNombre es una cadena vacía y, en ese caso, establece su valor en "indefinido"
            const articuloNombreText = articuloNombre.display_value.trim() !== "" ? articuloNombre.display_value : "INDEFINIDO";
            //Reestructuración de arreglo articulos.
            articulosMultiplicados.push({
              articulo: articuloNombreText,
              codigoKit: codigoKit,
              proceso: proceso.text,
              codigoMarca: codigoMarca.display_value,
              codigoInterno: codigoInterno.display_value,
              familia: familia.display_value,
              cantidadUnidad: cantidadUnidad,
              cantidad: cantidadTotal,
              precioNeto: precioNeto,
              unidadMedida: unidadMedida.display_value,
              idProveedor: idProveedor.display_value !== "" ? { item_ids: [parseInt(idProveedor.display_value)] } : null,
              proveedor: proveedor.display_value
            });
          }
        }
      }
    }
    return articulosMultiplicados;
  } else {
    throw new Error("El array 'items' está vacío o hay un error en la respuesta JSON.");
  }
}
//Método que permite registrar los articulos en el tablero lista de materiales
async function registrarArticulosEnTablero(tableroId, articulos) {
  try {
    const batchSize = 35;
    const totalArticulos = articulos.length;
    for (let startIndex = 0; startIndex < totalArticulos; startIndex += batchSize) {
      const endIndex = Math.min(startIndex + batchSize, totalArticulos);
      const batch = articulos.slice(startIndex, endIndex);
      const promesasRegistro = batch.map(async (articulo) => {
        const proveedor = articulo.proveedor || 'SIN ASIGNAR'
        const updatedGroups = await obtenerGruposExistentes(tableroId);
        const grupoExistente = updatedGroups.find(group => group.title === proveedor);
        if (grupoExistente) {
          const nombreArticulo = articulo.articulo;
          const articuloNombreEscapado = escaparComillasDobles(nombreArticulo);
          var columnValues = {
            texto13: articulo.codigoKit,
            texto1: articulo.proceso,
            texto9: articulo.codigoMarca,
            texto: articulo.codigoInterno,
            texto0: articulo.familia,
            n_meros: articulo.precioNeto,
            n_meros39: articulo.cantidadUnidad,
            n_meros0: articulo.cantidad,
            texto7: articulo.unidadMedida,
            conectar_tableros7: articulo.idProveedor
          };
          var columnValuesJSON = JSON.stringify(columnValues).replace(/"/g, '\\"');
          const solicitud = {
            query: `
            mutation {
              create_item(
                board_id: ${tableroId},
                group_id: "${grupoExistente.id}",
                item_name: "${articuloNombreEscapado}",
                column_values: "${columnValuesJSON}",
              ) {
                id
              }
            }
          `
          };
          try {
            const respuesta = await axios.post('https://api.monday.com/v2', solicitud, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjM4MDk5MjcyMiwiYWFpIjoxMSwidWlkIjo0MDY5NzEwMSwiaWFkIjoiMjAyNC0wNy0wNVQyMTowMjozMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTA5Mjg0OTUsInJnbiI6InVzZTEifQ.55PVw2YfNZ7d7DUgqfEOl4vLHlh3MU5QGnwReMl-NpQ'
              },
              timeout: 25000,  // Tiempo de espera en milisegundos (10 segundos)
              family: 4  // Añade esta línea para usar IPv4
            });
            if (respuesta.data && respuesta.data.data.create_item) {
              console.log(`Artículo "${articulo.articulo}" agregado correctamente.`);
            } else {
              console.error(`Error al agregar el artículo "${articulo.articulo}".`);
            }
          } catch (error) {
            console.error(`Error al agregar el artículo "${articulo.articulo}":`, error);
          }
        } else {
          console.log(`No se encontró el grupo correspondiente para el proveedor. No se ha creado el artículo.`);
        }
      });
      //Esperar a que se cumplan todas las promesas
      await Promise.all(promesasRegistro);
      //Esperar 5000 milisegundos entre lotes de registros.
      await new Promise(resolve => setTimeout(resolve, 8000));
    }
    console.log('Todos los artículos se han agregado correctamente.');
  } catch (error) {
    console.error('Ocurrió un error:', error);
  }
}
// Método para registrar los kits en el tablero de almacen
async function registrarKitsAlmacen(tableroId, allKits, cantidadProducto, idOP) {
  try {
    const batchSize = 35;
    const totalKits = allKits.length;

    async function registrarKit(kit) {
      //console.log(kit.id);
      var columnValues = {
        n_meros: kit.cantidad * cantidadProducto,
        n_meros16: cantidadProducto,
        conectar_tableros1: kit.id !== "" ? { item_ids: [parseInt(kit.id)] } : null
      };
      var columnValuesJSON = JSON.stringify(columnValues).replace(/"/g, '\\"');
      const solicitud = {
        query: `
          mutation {
            create_item(
              board_id: ${tableroId},
              group_id: "topics",
              item_name: "${kit.configuracion}",
              column_values: "${columnValuesJSON}",
            ) {
              id
            }
          }
        `
      };
      try {
        const respuesta = await axios.post('https://api.monday.com/v2', solicitud, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjM4MDk5MjcyMiwiYWFpIjoxMSwidWlkIjo0MDY5NzEwMSwiaWFkIjoiMjAyNC0wNy0wNVQyMTowMjozMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTA5Mjg0OTUsInJnbiI6InVzZTEifQ.55PVw2YfNZ7d7DUgqfEOl4vLHlh3MU5QGnwReMl-NpQ',
            'API-Version': '2026-01'
          },
          timeout: 25000,  // Tiempo de espera en milisegundos (10 segundos)
          family: 4  // Añade esta línea para usar IPv4
        });
        if (respuesta.data && respuesta.data.data.create_item) {
          if (kit.id != "") {
            var arrayArticulos = await getArticulosAlmacen(kit.id);
            const idKit = respuesta.data.data.create_item.id;
            //console.log(arrayArticulos);
            await registrarArticulosAlmacen(idKit, arrayArticulos, kit.cantidad, cantidadProducto, idOP);
          }
        } else {
          console.error(`Error al agregar el kit "${kit.configuracion}".`);
        }
      } catch (error) {
        console.error(`Error al agregar el kit "${kit.configuracion}":`, error);
      }
    }

    // Ordenar los kits utilizando la función de comparación
    allKits.sort((kitA, kitB) => compararKits(kitA, kitB));

    for (let startIndex = 0; startIndex < totalKits; startIndex += batchSize) {
      const endIndex = Math.min(startIndex + batchSize, totalKits);
      const batch = allKits.slice(startIndex, endIndex);
      for (const kit of batch) {
        await registrarKit(kit);
        // Esperar 3000 milisegundos entre kits
        await new Promise(resolve => setTimeout(resolve, 2200));
      }
    }

    console.log('Todos los kits se han agregado correctamente.');
  } catch (error) {
    console.error('Ocurrió un error:', error);
  }
}

// Método para registrar los artículos en los subelementos en el tablero de almacen
async function registrarArticulosAlmacen(idKit, articulos, cantidad, cantidadProducto, idOP) {
  try {
    const batchSize = 40;
    const totalArticulos = articulos.length;

    async function registrarArticulo(articulo) {
      //console.log(articulo);
      var columnValues = {
        conectar_tableros: articulo.idMaterial,
        texto: articulo.proceso,
        n_meros6: articulo.cantidadMaterial,
        n_meros: parseFloat(articulo.cantidadMaterial) * cantidad * cantidadProducto,
        conectar_tableros5: { item_ids: [parseInt(idOP)] }
      };
      var columnValuesJSON = JSON.stringify(columnValues).replace(/"/g, '\\"');
      const solicitud = {
        query: `
        mutation {
          create_subitem (parent_item_id: ${idKit}, item_name: "${articulo.nombre}", column_values: "${columnValuesJSON}") {
            id
            board {
              id
            }
          }
        }
        `
      };
      try {
        const respuesta = await axios.post('https://api.monday.com/v2', solicitud, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjM4MDk5MjcyMiwiYWFpIjoxMSwidWlkIjo0MDY5NzEwMSwiaWFkIjoiMjAyNC0wNy0wNVQyMTowMjozMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTA5Mjg0OTUsInJnbiI6InVzZTEifQ.55PVw2YfNZ7d7DUgqfEOl4vLHlh3MU5QGnwReMl-NpQ',
            'API-Version': '2026-01'
          },
          timeout: 45000,  // Tiempo de espera en milisegundos (10 segundos)
          family: 4  // Añade esta línea para usar IPv4
        });
        console.log(respuesta.data);
        return respuesta;
      } catch (error) {
        console.error(`Error al agregar el artículo "${articulo.nombre}":`, error);
      }
    }

    // Ordenar los artículos utilizando la función de comparación
    articulos.sort((articuloA, articuloB) => compararArticulos(articuloA, articuloB));

    for (let startIndex = 0; startIndex < totalArticulos; startIndex += batchSize) {
      const endIndex = Math.min(startIndex + batchSize, totalArticulos);
      const batch = articulos.slice(startIndex, endIndex);
      for (const articulo of batch) {
        await registrarArticulo(articulo);
        // Esperar 2000 milisegundos entre artículos
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }

    console.log('Todos los artículos se han agregado correctamente.');
  } catch (error) {
    console.error('Ocurrió un error:', error);
  }
}
// Función de comparación para ordenar los kits
function compararKits(kitA, kitB) {
  const regex = /(\d+)\.-\s(.+)/;
  const matchA = kitA.configuracion.match(regex);
  const matchB = kitB.configuracion.match(regex);
  const numA = matchA ? parseInt(matchA[1]) : Number.MAX_VALUE;
  const numB = matchB ? parseInt(matchB[1]) : Number.MAX_VALUE;
  const textA = matchA ? matchA[2] : kitA.configuracion;
  const textB = matchB ? matchB[2] : kitB.configuracion;

  if (numA !== numB) {
    return numA - numB;
  } else {
    return textA.localeCompare(textB);
  }
}

// Función de comparación para ordenar los artículos
function compararArticulos(articuloA, articuloB) {
  const numeroA = extraerNumero(articuloA.nombre);
  const numeroB = extraerNumero(articuloB.nombre);
  return numeroA - numeroB;
}

function extraerNumero(cadena) {
  const match = cadena.match(/(\d+)/);
  if (match) {
    return parseInt(match[0]);
  } else {
    return 0; // Si no se encuentra ningún número, se asume 0
  }
}

//Método que permite obtener los articulos de cada Kit.
async function getArticulosAlmacen(itemId) {
  const query = `query {
    items(ids: ${JSON.stringify([itemId]).replace(/"/g, "")}) {
      subitems {
        name
        column_values(ids: ["reflejo3", "texto","n_meros"]) {
          id
          text
          ...on MirrorValue {
            display_value
          }
        }
      }
    }
  }`;
  const version = '2026-01';
  const response = await sendMondayApiRequest(query, version);
  //console.log(response.data.data);
  if (response.data && Array.isArray(response.data.data.items)) {
    const materialesKits = [];
    for (const item of response.data.data.items) {
      const subitems = item.subitems;
      // Verifica si hay subitems antes de procesarlos
      if (subitems) {
        for (const subitem of subitems) {

          const nombre = subitem.name;
          const proceso = subitem.column_values.find(column => column.id === "texto");
          const cantidadMaterial = subitem.column_values.find(column => column.id === "n_meros");
          const idMaterial = subitem.column_values.find(column => column.id === "reflejo3");

          //Reestructuración de arreglo.
          materialesKits.push({
            nombre: nombre,
            proceso: proceso.text,
            cantidadMaterial: cantidadMaterial.text !== "" ? cantidadMaterial.text : 0,
            idMaterial: idMaterial.display_value !== "" ? { item_ids: [parseInt(idMaterial.display_value)] } : null,
          });
        }
      }
    }
    return materialesKits;
  }

}
// Función de escape para comillas dobles
function escaparComillasDobles(texto) {
  return texto.replace(/["\\]/g, '\\$&');
}
//Método para obtener los proveedores únicos de una lista de materiales
function obtenerProveedoresUnicos(materiales) {
  const uniqueProviders = new Set();
  materiales.forEach(material => {
    const proveedor = material.proveedor || 'SIN ASIGNAR';
    uniqueProviders.add(proveedor);
  });
  return Array.from(uniqueProviders);
}
//Permite obtener todos los grupos (Proveedores) de una lista de materiales
async function obtenerGruposExistentes(boardId) {
  try {
    const query = `query {
        boards (ids: ${boardId}) {
          groups {
            id
            title
          }
        }
      }`;
    const version = '2026-01';
    // Realiza la solicitud a la API de monday.com
    const response = await sendMondayApiRequest(query, version);
    return response.data.data.boards[0].groups;
  } catch (error) {
    throw new Error('Error al obtener los grupos existentes:', error);
  }
}
//Método que permite crear grupos en listas de materiales
async function crearGrupo(boardId, groupTitle) {
  try {
    const query =
      `mutation {
        create_group (board_id: ${boardId}, group_name: "${groupTitle}", relative_to: "topics", position_relative_method: before_at) {
          id
        }
      }
      `;
    const version = '2026-01';
    // Realiza la solicitud a la API de monday.com
    const response = await sendMondayApiRequest(query, version);
    //console.log(response);
  } catch (error) {
    throw new Error(`Error al crear el grupo para ${groupTitle}: ${error}`);
  }
}
//Método que retorna una cadena en base64 que porteriormente se convertirá en un archivo PDF
async function obtenerDocumentoOP(datosOP, kitsProducto) {

  const codigoInterno = datosOP[0].column_values.find(item => item.id === 'conectar_tableros').display_value;
  const empresa = datosOP[0].column_values.find(item => item.id === 'reflejo1').display_value;
  const producto = datosOP[0].column_values.find(item => item.id === 'reflejo7').display_value;
  const fechaExpedicion = cambiarFormatoFecha(datosOP[0].column_values.find(item => item.id === 'fecha').text);
  const unidadesFabricar = datosOP[0].column_values.find(item => item.id === 'n_meros3').text;
  const fechaContrato = cambiarFormatoFecha(datosOP[0].column_values.find(item => item.id === 'fecha4').text);
  const color = datosOP[0].column_values.find(item => item.id === 'texto16').text;
  const fechaEntrega = cambiarFormatoFecha(datosOP[0].column_values.find(item => item.id === 'fecha7').text);
  const longitud = datosOP[0].column_values.find(item => item.id === 'n_meros4').text;
  const anchoEnterior = datosOP[0].column_values.find(item => item.id === 'n_meros6').text;
  const alto = datosOP[0].column_values.find(item => item.id === 'n_meros67').text;
  const grabado = datosOP[0].column_values.find(item => item.id === 'texto7').text;
  const capacidad = datosOP[0].column_values.find(item => item.id === 'texto9').text;
  const responsable = datosOP[0].column_values.find(item => item.id === 'texto4').text;
  const revisor = datosOP[0].column_values.find(item => item.id === 'estado2').text;
  const autorizacion = datosOP[0].column_values.find(item => item.id === 'estado_1').text;

  const opciones = {
    orientation: "p",
    unit: "mm",
    format: "letter",
  };

  const encabezado = imagenes.encabezado;
  const pieDePagina = imagenes.pieDePagina;
  const doc = new jsPDF(opciones);
  doc.autoTable({
    margin: { left: 15, right: 15, top: 78, bottom: 55 },
    tableWidth: "auto", // Permite que la tabla se ajuste automáticamente al ancho disponible
    headStyles: {
      halign: 'center', // Alinea horizontalmente los títulos
      fillColor: [38, 74, 148],
      textColor: [255, 255, 255],
    },
    styles: {
      valign: "middle",
      fontSize: 5,
      font: "helvetica", // Fuente en negrita
      fontStyle: "bold"
    },
    columnStyles: {
      'codigoKit': { halign: 'center' }, // Aplica estilo a los enlaces
      'cantidadKit': { halign: 'center' },
    },
    columns: [
      { header: 'Configuración', dataKey: 'name' },
      { header: 'Cód. Kit', dataKey: 'codigoKit' },
      { header: 'Cantidad X U.', dataKey: 'cantidadKit' },
      { header: 'Descripción', dataKey: 'nombreKit' },
    ],
    body: kitsProducto,
    willDrawCell: function (data) {
      if (data.section === 'body' && data.column.dataKey === 'codigoKit') {
        const kitCode = data.cell.raw; // Obtén el texto del código del kit
        const url = `https://transtools-team.monday.com/boards/4753135434?term=${kitCode}`;
        const textWidth = doc.getTextWidth(kitCode); // Calcula el ancho del texto
        const padding = 4; // Añade un poco de espacio adicional
        data.cell.styles.cellWidth = textWidth + padding; // Ajusta el ancho de la celda
        data.cell.text = ''; // Limpia el contenido de la celda
      }
    },

    didDrawCell: function (data) {
      if (data.section === 'body' && data.column.dataKey === 'codigoKit') {
        const kitCode = data.cell.raw; // Obtén el texto del código del kit
        const url = `https://transtools-team.monday.com/boards/4753135434?term=${kitCode}`;

        // Cálculos para centrar el texto
        const textWidth = doc.getTextWidth(kitCode); // Ancho del texto
        const textHeight = 1; // Establece una altura estándar para el texto (ajustar si es necesario)

        // Cálculo de la posición horizontal (centrado)
        const xOffset = data.cell.x + (data.cell.width - textWidth) / 2;

        // Cálculo de la posición vertical (centrado)
        const yOffset = data.cell.y + (data.cell.height / 2) + (textHeight / 2); // Ajusta el centro vertical

        // Dibuja el enlace centrado en la celda
        doc.setTextColor(0, 0, 255);
        doc.textWithLink(kitCode, xOffset, yOffset, { url: url });

        // Restaura el color del texto para otras celdas
        doc.setTextColor(0, 0, 0);
      }
    }
  });
  // Dimensiones de la página
  const pageHeight = doc.internal.pageSize.height;
  const marginBottom = 55; // Margen inferior definido
  const marginTop = 78; // Margen superior definido

  // Añadir las observaciones
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(6);
  doc.setTextColor(0, 0, 0);

  // Calcular posición inicial para las observaciones
  let currentY = doc.lastAutoTable.finalY + 7; // Posición inicial debajo de la tabla

  if (currentY + 30 > pageHeight - marginBottom) { // Si excede el margen inferior
    doc.addPage(); // Añadir nueva página
    currentY = marginTop; // Reiniciar la posición en la nueva página
  }
  doc.text('Observaciones:', 15, currentY);

  // Recuadro de Observaciones
  const boxXObservaciones = 15;
  const boxWidthObservaciones = 186;
  const boxHeightObservaciones = 30;

  doc.setDrawColor(0); // Color del borde
  doc.setLineWidth(0.3); // Grosor del borde
  doc.roundedRect(boxXObservaciones, currentY + 3, boxWidthObservaciones, boxHeightObservaciones, 5, 5); // Rectángulo redondeado

  const observaciones = datosOP[0].column_values.find(item => item.id === 'texto').text;
  const numeroCambios = datosOP[0].column_values.find(item => item.id === 'n_meros9').text;
  doc.setFontSize(6);
  doc.text(observaciones, boxXObservaciones + 3, currentY + 7, { maxWidth: boxWidthObservaciones - 10 });

  // Añadir los cambios
  currentY += boxHeightObservaciones + 7; // Ajustar posición para el siguiente recuadro

  if (currentY + 25 > pageHeight - marginBottom) { // Si excede el margen inferior
    doc.addPage(); // Añadir nueva página
    currentY = marginTop; // Reiniciar la posición en la nueva página
  }
  doc.text(`No. Cambios (${numeroCambios}):`, 15, currentY);

  // Recuadro de Cambios
  const boxXCambios = 15;
  const boxWidthCambios = 186;
  const boxHeightCambios = 25;

  doc.setDrawColor(0); // Color del borde
  doc.setLineWidth(0.3); // Grosor del borde
  doc.roundedRect(boxXCambios, currentY + 3, boxWidthCambios, boxHeightCambios, 5, 5);

  const cambios = datosOP[0].column_values.find(item => item.id === 'texto_largo').text;
  doc.text(cambios, boxXCambios + 5, currentY + 7, { maxWidth: boxWidthCambios - 10 });

  // Calcular el número total de páginas
  const totalPages = doc.internal.getNumberOfPages();

  // Recorrer y modificar cada página para incluir el número de página
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    //Añade encabezado y pie de página a las hojas del documento
    doc.addImage(encabezado, "PNG", -1, 1, 216, 15);
    doc.addImage(pieDePagina, "PNG", -1, 263, 218, 15);
    //estilo de texto
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`ORDEN DE PRODUCCIÓN ${datosOP[0].name}`, 108, 22, { align: "center" });
    doc.setFontSize(6);
    doc.setTextColor(0, 0, 0);
    doc.text(`Página ${i} de ${totalPages}`, 105, 278);

    doc.autoTable({
      margin: { left: 15, right: 15 },
      tableWidth: "auto", // Permite que la tabla se ajuste automáticamente al ancho disponible
      startY: 25,
      bodyStyles: {
        valign: "middle",
        fontSize: 5,
        font: "helvetica", // Fuente en negrita
        fontStyle: "bold"
      },
      styles: {
        lineWidth: 0.2, // Grosor de las líneas de las celdas
        lineColor: [158, 158, 158], // Color de las líneas de las celdas (negro)
      },
      body: [
        [
          { content: 'Datos del Cliente', colSpan: 4, styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255] } },
          { content: 'Cód. Interno:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: codigoInterno, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0], cellWidth: 31 } },
        ],
        [
          { content: 'Empresa:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: empresa, colSpan: 3, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } },
          { content: 'Número OP:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWith: 31 } },
          { content: datosOP[0].name, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0], cellWith: 31 } },
        ],
        [
          { content: 'Producto:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: producto, colSpan: 3, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } },
          { content: 'Fecha de Expedición', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: fechaExpedicion, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0], cellWidth: 31 } },
        ],
        [
          { content: 'Unidades a Fábricar:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: unidadesFabricar, colSpan: 3, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } },
          { content: 'Fecha Contrato:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: fechaContrato, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0], cellWidth: 31 } },
        ],
        [
          { content: 'Color:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: color, colSpan: 3, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } },
          { content: 'Fecha de Entrega:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: fechaEntrega, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0], cellWidth: 31 } },
        ],
        [
          { content: 'Datos Generales del Producto', colSpan: 6, styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255] } },
        ],
        [
          { content: 'Longitud Total:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: longitud + " Mtrs.", styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0], cellWidth: 31 } },
          { content: 'Ancho Exterior:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: anchoEnterior + " Mtrs.", styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0], cellWidth: 31 } },
          { content: 'Alto Total:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: alto + " Mtrs.", styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0], cellWidth: 31 } },
        ],
        [
          { content: 'Grabado:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255] } },
          { content: grabado, colSpan: 3, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } },
          { content: 'Capacidad:', styles: { halign: 'center', fillColor: [92, 92, 102], textColor: [255, 255, 255], cellWidth: 31 } },
          { content: capacidad, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0], cellWidth: 31 } },
        ],
      ]
    });
    // Obtener la posición final de la primera tabla
    const lastTableY = doc.lastAutoTable.finalY;
    doc.setFontSize(6);
    doc.setTextColor(0, 0, 0);
    doc.text("Características del Producto", 93, lastTableY + 4, { halign: 'center' });
    doc.autoTable({
      margin: { left: 15, right: 15 },
      tableWidth: "auto", // Permite que la tabla se ajuste automáticamente al ancho disponible
      startY: 230,
      bodyStyles: {
        valign: "middle",
        fontSize: 5,
        font: "helvetica", // Fuente en negrita
        fontStyle: "bold"
      },
      styles: {
        lineWidth: 0.2, // Grosor de las líneas de las celdas
        lineColor: [158, 158, 158], // Color de las líneas de las celdas (negro)
      },
      body: [
        [
          { content: 'Responsable:', styles: { halign: 'center', fillColor: [217, 217, 217], textColor: [0, 0, 0] } },
          { content: 'Revisó:', styles: { halign: 'center', fillColor: [217, 217, 217], textColor: [0, 0, 0] } },
          { content: 'Autorizó:', styles: { halign: 'center', fillColor: [217, 217, 217], textColor: [0, 0, 0] } },
        ],
        [
          { content: responsable, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } },
          { content: revisor, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } },
          { content: autorizacion, styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } },
        ],
      ]
    });
    doc.setFontSize(6);
    doc.setTextColor(0, 0, 0);
    doc.text('C.c.p.', 160, 245);
    doc.text('Ventas __________________', 201, 245, { align: 'right' });
    doc.text('Diseño __________________', 201, 248, { align: 'right' });
    doc.text('Almacén __________________', 201, 251, { align: 'right' });
    doc.text('Producción __________________', 201, 254, { align: 'right' });

  }
  const pdfBase64 = doc.output('datauristring');
  return pdfBase64;

}
//Método para cambiar formato Fecha
function cambiarFormatoFecha(fecha) {
  const partesFecha = fecha.split('-');
  if (partesFecha.length !== 3) {
    throw new Error('Formato de fecha inválido');
  }
  // Reorganizar las partes de la fecha
  const nuevaFecha = `${partesFecha[2]}-${partesFecha[1]}-${partesFecha[0]}`;
  return nuevaFecha;
}
//Método para obtener las características de la OP
async function getCharacteristicsOP(pulseId) {
  const query = `query {
    items(ids: ${JSON.stringify([pulseId]).replace(/"/g, "")}) {
      name
      column_values{
        id
        text
        ...on MirrorValue {
          display_value
        }
        ...on BoardRelationValue {
          display_value
        }
      }
 }
}`;
  const version = '2026-01';
  const response = await sendMondayApiRequest(query, version);
  if (response.data && Array.isArray(response.data.data.items)) {
    //console.log(response.data.data);
    return response.data.data.items;
  }

}
//Método para obtener todos los Kits del producto
async function getSubitemsKits(idProducto) {
  const query = `query {
    items(ids: ${JSON.stringify([idProducto]).replace(/"/g, "")}) {
      subitems {               
        name
        column_values (ids: ["conectar_tableros", "reflejo7", "n_meros"]){
          id
          text
          ...on MirrorValue {
            display_value
          }
          ...on BoardRelationValue {
            display_value
          }
        }
      }
    }
  }`;
  const version = '2026-01';
  const response = await sendMondayApiRequest(query, version);
  if (response.data && Array.isArray(response.data.data.items)) {
    const kits = [];
    for (const item of response.data.data.items) {
      for (const subitem of item.subitems) {
        // Procesa los subitems aquí
        const nombreKit = subitem.column_values.find(column => column.id === "conectar_tableros");
        const codigo = subitem.column_values.find(column => column.id === "reflejo7");
        const cantidadKit = subitem.column_values.find(column => column.id === "n_meros");
        if (nombreKit && codigo) {
          kits.push({
            name: subitem.name,
            codigoKit: codigo.display_value,
            nombreKit: nombreKit.display_value,
            cantidadKit: cantidadKit.text
          });
        }
      }
    }
    // Ordenar los kits por el número y luego por el texto
    kits.sort((a, b) => {
      const regex = /(\d+)\.-\s(.+)/;
      const matchA = a.name.match(regex);
      const matchB = b.name.match(regex);
      // Extraer número si existe, o asignar un valor predeterminado alto
      const numA = matchA ? parseInt(matchA[1]) : Number.MAX_VALUE;
      const numB = matchB ? parseInt(matchB[1]) : Number.MAX_VALUE;
      const textA = matchA ? matchA[2] : a.name;
      const textB = matchB ? matchB[2] : b.name;
      // Comparar primero por número y luego por el texto
      if (numA !== numB) {
        return numA - numB;
      } else {
        // Si los números son iguales, comparar por texto
        return textA.localeCompare(textB);
      }
    });
    return kits;
  } else {
    throw new Error("El array 'items' está vacío o hay un error en la respuesta JSON.");
  }
}
//Este Método nos permite subir los documentos PDF a monday.com
async function subirArchivoAMonday(pulseId, pdfBase64, nombreArchivo) {
  const query = `
    mutation ($file: File!) {
      add_file_to_column(file: $file, item_id: ${pulseId}, column_id: "archivo") {
        id
      }
    }
  `;

  const formData = new FormData();
  formData.append('query', query);

  // Convierte la cadena base64 a Blob antes de adjuntarla a FormData
  const pdfBlob = new Blob([Buffer.from(pdfBase64.split(',')[1], 'base64')], { type: 'application/pdf' });
  formData.append('variables[file]', pdfBlob, nombreArchivo + '.pdf');
  try {
    const response = await axios.post('https://api.monday.com/v2/file', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjM4MDk5MjcyMiwiYWFpIjoxMSwidWlkIjo0MDY5NzEwMSwiaWFkIjoiMjAyNC0wNy0wNVQyMTowMjozMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTA5Mjg0OTUsInJnbiI6InVzZTEifQ.55PVw2YfNZ7d7DUgqfEOl4vLHlh3MU5QGnwReMl-NpQ' //API key
      },
      timeout: 25000,  // Tiempo de espera en milisegundos (10 segundos)
      family: 4  // Añade esta línea para usar IPv4
    });
    return response
  } catch (error) {
    console.error('Error al subir el archivo a monday.com:', error);
  }
}

//Método que envía los datos a la API Monday.com
async function sendMondayApiRequest(query, version) {
  try {
    const response = await axios.post('https://api.monday.com/v2', {
      query: query
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjM4MDk5MjcyMiwiYWFpIjoxMSwidWlkIjo0MDY5NzEwMSwiaWFkIjoiMjAyNC0wNy0wNVQyMTowMjozMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTA5Mjg0OTUsInJnbiI6InVzZTEifQ.55PVw2YfNZ7d7DUgqfEOl4vLHlh3MU5QGnwReMl-NpQ',
        'API-Version': version
      },
      timeout: 45000, // Establecer un tiempo de espera de 5 segundos
      family: 4 // Forzar el uso de IPv4
    });
    return response;
  } catch (error) {
    console.error('Error en la solicitud a Monday.com:', error);
    console.error('Detalles del error:', error.response ? error.response.data : error.message);
    throw error;
  }
}

//Este método de Express permite escuchar el puerto en el que se ejecuta la aplicación.
app.listen(port, () => {
  console.log(`Listen on port ${port}`);
});
