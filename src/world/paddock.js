import * as THREE from 'three';

const PX = 24; // pixels por metro na textura
const MARGIN = 4;

const NAMES = {
	porsche: 'PORSCHE', ferrari: 'FERRARI', audi: 'AUDI', 'vanellope-kart': 'VANELLOPE',
	spiderman: 'HOMEM-ARANHA', vanellope: 'VANELLOPE', optimus: 'OPTIMUS',
};

// Pátio pintado no chão com uma vaga por carro e um círculo por personagem, gerado a partir do
// LAYOUT (os da Vanellope em verde-água).
export function createPaddock( layout, y = 0 ) {

	const group = new THREE.Group();
	group.name = 'paddock';
	group.position.y = y;

	const slots = Object.entries( layout.cars );
	const people = [ ...Object.entries( layout.characters ), [ 'optimus', layout.optimus ] ];
	group.add( pad( slots, people, 5.2 ) );
	return group;

}

const RADIUS = { optimus: 4 };

function pad( slots, people, slotWidth ) {

	const points = [ ...slots, ...people ].map( ( [ , s ] ) => s.position );
	const box = new THREE.Box2();
	for ( const p of points ) box.expandByPoint( new THREE.Vector2( p.x, p.z ) );
	box.expandByScalar( MARGIN + 3 );

	const size = box.getSize( new THREE.Vector2() );
	const canvas = document.createElement( 'canvas' );
	canvas.width = Math.ceil( size.x * PX );
	canvas.height = Math.ceil( size.y * PX );
	const ctx = canvas.getContext( '2d' );
	const toPx = ( x, z ) => [ ( x - box.min.x ) * PX, ( z - box.min.y ) * PX ];

	ctx.fillStyle = '#6f6a78';
	roundRect( ctx, 0, 0, canvas.width, canvas.height, 3 * PX );
	ctx.fill();
	ctx.strokeStyle = '#ff9ccf';
	ctx.lineWidth = 0.35 * PX;
	ctx.stroke();

	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';

	// Vagas: linhas brancas entre os carros e o nome no fundo da vaga.
	for ( const [ id, s ] of slots ) {

		const [ cx, cz ] = toPx( s.position.x, s.position.z );
		const w = slotWidth * PX, l = 6.4 * PX;
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 0.15 * PX;
		ctx.strokeRect( cx - w / 2, cz - l / 2, w, l );
		ctx.fillStyle = id.startsWith( 'vanellope' ) ? '#7dffd0' : '#ffffff';
		ctx.font = `bold ${ 0.75 * PX }px system-ui, sans-serif`;
		ctx.fillText( NAMES[ id ] ?? id.toUpperCase(), cx, cz + l / 2 - 0.6 * PX );

	}

	// Faixa quadriculada na frente das vagas (lado das ilhas).
	if ( slots.length ) {

		const front = Math.min( ...slots.map( ( [ , s ] ) => s.position.z ) ) - 4.2;
		const [ , fz ] = toPx( 0, front );
		const sq = 0.6 * PX;
		for ( let x = 0, i = 0; x < canvas.width; x += sq, i ++ ) for ( let r = 0; r < 2; r ++ ) {

			ctx.fillStyle = ( i + r ) % 2 ? '#111111' : '#ffffff';
			ctx.fillRect( x, fz + r * sq, sq, sq );

		}

	}

	// Personagens: círculo com o nome.
	for ( const [ id, s ] of people ) {

		const personRadius = RADIUS[ id ] ?? 1.4;
		const [ cx, cz ] = toPx( s.position.x, s.position.z );
		ctx.strokeStyle = id.startsWith( 'vanellope' ) ? '#7dffd0' : '#ffd400';
		ctx.lineWidth = 0.2 * PX;
		ctx.beginPath();
		ctx.arc( cx, cz, personRadius * PX, 0, Math.PI * 2 );
		ctx.stroke();
		ctx.fillStyle = ctx.strokeStyle;
		ctx.font = `bold ${ Math.min( 0.6, personRadius * 0.3 ) * PX }px system-ui, sans-serif`;
		ctx.fillText( NAMES[ id ] ?? id.toUpperCase(), cx, cz + ( personRadius + 0.7 ) * PX );

	}

	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;

	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry( size.x, size.y ),
		new THREE.MeshStandardMaterial( { map: texture, roughness: 0.9, transparent: true, polygonOffset: true, polygonOffsetFactor: - 2 } )
	);
	mesh.rotation.x = - Math.PI / 2;
	const center = box.getCenter( new THREE.Vector2() );
	mesh.position.set( center.x, 0.03, center.y );
	mesh.receiveShadow = true;
	return mesh;

}

function roundRect( ctx, x, y, w, h, r ) {

	ctx.beginPath();
	ctx.moveTo( x + r, y );
	ctx.arcTo( x + w, y, x + w, y + h, r );
	ctx.arcTo( x + w, y + h, x, y + h, r );
	ctx.arcTo( x, y + h, x, y, r );
	ctx.arcTo( x, y, x + w, y, r );
	ctx.closePath();

}
