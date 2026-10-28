import * as THREE from 'three';

// Onde cada coisa fica. Carros e personagens começam na praça quadriculada de largada da pista
// (~30 m acima do gramado). A parte livre dela é x 31..66, z 46..84: ao norte há marshmallows e no
// canto sudeste um bloco de glacê. A altura de cada um é ajustada ao terreno ao carregar.
// A frente dos carros e personagens é -Z. A pista sai da praça pelo oeste (parte laranja).
//
//              marshmallows (norte, -Z)
//    [vanellope-kart] [audi] [ferrari] [porsche]
//  ← pista   vanellope      homem-aranha       Optimus
//              rampa ↓ (sul, +Z) até o gramado, onde ficam a garagem e o slalom de cones
//
// A Vanellope e o carro dela ainda vão ser adicionados; os lugares já ficam reservados aqui.
const spot = ( x, z, yaw = 0 ) => ( { position: new THREE.Vector3( x, 0, z ), yaw } );

export const LAYOUT = {
	// No gramado, ao lado do pé da rampa (que termina em x 47, z 237), com o portão para o sul.
	garage: new THREE.Vector3( 76, 0, 246 ),
	cars: {
		porsche: spot( 62, 54 ),
		ferrari: spot( 55, 54 ),
		audi: spot( 48, 54 ),
		'vanellope-kart': spot( 41, 54 ),
	},
	characters: {
		spiderman: spot( 56, 63 ),
		vanellope: spot( 46, 63 ),
	},
	optimus: spot( 67, 62 ),
	// Slalom de cones no gramado, depois da garagem.
	cones: { from: new THREE.Vector3( 100, 0, 275 ), to: new THREE.Vector3( 210, 0, 275 ), spacing: 10, weave: 4 },
	// Limite do mundo (as montanhas no horizonte ficam além dele).
	worldLimit: 330,
};
