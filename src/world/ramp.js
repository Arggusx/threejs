import * as THREE from 'three';

const THICKNESS = 1.2;
const RAIL = 1.1;

// Rampa de "doce" que liga a praça de largada (no alto) ao gramado. `top` é o meio da borda de
// cima, `direction` aponta para baixo da rampa (no plano XZ). Devolve o grupo e as malhas que viram
// chão (`floors`) e obstáculo (`solids`) no terreno.
export function createRamp( { top, direction, length, width } ) {

	const group = new THREE.Group();
	group.name = 'ramp';

	const drop = top.y;
	const slope = Math.atan2( drop, length );
	const span = Math.hypot( drop, length );
	const dir = direction.clone().setY( 0 ).normalize();
	const yaw = Math.atan2( dir.x, dir.z );

	const deck = new THREE.Group();
	deck.position.copy( top );
	deck.rotation.set( 0, yaw, 0 );
	group.add( deck );
	const tilt = new THREE.Group();
	tilt.rotation.x = slope;
	deck.add( tilt );

	const stripes = stripeTexture();
	stripes.repeat.set( 1, span / 6 );
	const surface = new THREE.MeshStandardMaterial( { map: stripes, roughness: 0.55 } );
	const chocolate = new THREE.MeshStandardMaterial( { color: 0x5a2e1c, roughness: 0.7 } );
	const cane = new THREE.MeshStandardMaterial( { color: 0xffffff, roughness: 0.35 } );

	// Tabuleiro (topo listrado, lados de chocolate). Começa um pouco antes para encostar na praça.
	const slab = new THREE.Mesh( new THREE.BoxGeometry( width, THICKNESS, span + 1 ), [ chocolate, chocolate, surface, chocolate, chocolate, chocolate ] );
	slab.position.set( 0, - THICKNESS / 2, span / 2 - 0.5 );
	tilt.add( slab );

	// Só a superfície de cima é chão no terreno; o tabuleiro em si é obstáculo (por baixo dele
	// não dá para "pisar" na face inferior).
	const deckSurface = new THREE.Mesh( new THREE.PlaneGeometry( width, span + 1 ) );
	deckSurface.rotation.x = - Math.PI / 2;
	deckSurface.position.set( 0, 0, span / 2 - 0.5 );
	deckSurface.visible = false;
	tilt.add( deckSurface );

	const rails = [ slab ];
	for ( const side of [ - 1, 1 ] ) {

		const rail = new THREE.Mesh( new THREE.BoxGeometry( 0.35, RAIL, span ), cane );
		rail.position.set( side * ( width / 2 - 0.2 ), RAIL / 2, span / 2 );
		tilt.add( rail );
		rails.push( rail );

	}

	// Pilares de chocolate a cada ~22 m.
	const pillarGeometry = new THREE.CylinderGeometry( 0.9, 1.2, 1, 12 );
	for ( let d = 22; d < length - 10; d += 22 ) {

		const h = drop * ( 1 - d / length ) - THICKNESS;
		for ( const side of [ - 1, 1 ] ) {

			const pillar = new THREE.Mesh( pillarGeometry, chocolate );
			pillar.scale.y = h;
			pillar.position.set( top.x + dir.x * d + dir.z * side * ( width / 2 - 1.5 ), h / 2, top.z + dir.z * d - dir.x * side * ( width / 2 - 1.5 ) );
			group.add( pillar );
			rails.push( pillar );

		}

	}

	group.traverse( ( o ) => {

		if ( o.isMesh && o.visible ) o.castShadow = o.receiveShadow = true;

	} );

	return { object: group, floors: [ deckSurface ], solids: rails };

}

function stripeTexture() {

	const c = document.createElement( 'canvas' );
	c.width = 64;
	c.height = 256;
	const ctx = c.getContext( '2d' );
	ctx.fillStyle = '#ffe3f1';
	ctx.fillRect( 0, 0, 64, 256 );
	ctx.fillStyle = '#ff6fae';
	for ( let y = 0; y < 256; y += 64 ) ctx.fillRect( 0, y, 64, 28 );
	ctx.fillStyle = '#ffffff';
	ctx.fillRect( 0, 0, 3, 256 );
	ctx.fillRect( 61, 0, 3, 256 );

	const texture = new THREE.CanvasTexture( c );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.anisotropy = 8;
	return texture;

}
