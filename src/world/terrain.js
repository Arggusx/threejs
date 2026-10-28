import * as THREE from 'three';

const LAYERS = 4;
const MERGE = 0.4;
const NONE = - Infinity;
const BIN = 0.5; // altura de cada faixa de obstáculo (m); menor que o menor degrau (0,6 m)
const STEEP = 0.6; // |normal.y| abaixo disso é parede

// Terreno para carros e personagens, gerado a partir das malhas do cenário:
// - "chão" (pista, praça, rampa): cada célula guarda até LAYERS superfícies, então dá para passar por
//   baixo de pontes. Fora delas o chão é o gramado (`base`).
// - "sólidos" (ilhas, doces, paredes, guarda-corpos): cada célula marca em quais faixas de altura há
//   geometria, para bloquear quem tenta atravessar naquela altura.
// Quem se move consulta a superfície mais alta que alcança a partir da altura atual (`step`); se o chão
// à frente fica mais de `drop` abaixo, é beirada e bloqueia.
export class Terrain {

	constructor( { cell = 1, base = 0, minY = - 10, maxY = 150 } = {} ) {

		this.cell = cell;
		this.base = base;
		this.minY = minY;
		this.words = Math.ceil( ( maxY - minY ) / BIN / 32 );
		this.min = new THREE.Vector2();

	}

	build( { floors, solids } ) {

		const box = new THREE.Box3();
		for ( const m of [ ...floors, ...solids ] ) box.expandByObject( m );
		this.min.set( box.min.x, box.min.z );
		this.nx = Math.ceil( ( box.max.x - box.min.x ) / this.cell ) + 1;
		this.nz = Math.ceil( ( box.max.z - box.min.z ) / this.cell ) + 1;

		const cells = this.nx * this.nz;
		this.heights = new Float32Array( cells * LAYERS ).fill( NONE );
		this.bins = new Uint32Array( cells * this.words );

		for ( const m of floors ) this.eachTriangle( m, ( a, b, c ) => this.rasterize( a, b, c, true ) );
		for ( const m of solids ) this.eachTriangle( m, ( a, b, c ) => this.rasterize( a, b, c, false ) );

		return this;

	}

	eachTriangle( mesh, fn ) {

		const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
		mesh.updateWorldMatrix( true, false );
		const position = mesh.geometry.attributes.position;
		const index = mesh.geometry.index;
		const count = index ? index.count : position.count;

		for ( let i = 0; i < count; i += 3 ) {

			a.fromBufferAttribute( position, index ? index.getX( i ) : i ).applyMatrix4( mesh.matrixWorld );
			b.fromBufferAttribute( position, index ? index.getX( i + 1 ) : i + 1 ).applyMatrix4( mesh.matrixWorld );
			c.fromBufferAttribute( position, index ? index.getX( i + 2 ) : i + 2 ).applyMatrix4( mesh.matrixWorld );
			fn( a, b, c );

		}

	}

	rasterize( a, b, c, floor ) {

		const s = this.cell, ox = this.min.x, oz = this.min.y;
		const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const steep = Math.abs( ny ) < STEEP * Math.hypot( nx, ny, nz );

		// Paredes/encostas: amostra a superfície do triângulo em 3D e marca só a altura real de cada
		// ponto. (Marcar a faixa inteira do triângulo em toda a área dele criava "paredes fantasma"
		// em cima da pista, debaixo de encostas grandes.)
		if ( steep ) {

			const spacing = Math.min( s, BIN ) * 0.8;
			const n = Math.max( 1, Math.ceil( Math.max( a.distanceTo( b ), b.distanceTo( c ), c.distanceTo( a ) ) / spacing ) );
			for ( let i = 0; i <= n; i ++ ) for ( let j = 0; j <= n - i; j ++ ) {

				const u = i / n, v = j / n;
				const x = a.x + ux * u + vx * v, y = a.y + uy * u + vy * v, z = a.z + uz * u + vz * v;
				const ix = Math.round( ( x - ox ) / s ), iz = Math.round( ( z - oz ) / s );
				if ( ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz ) this.markSolid( ix, iz, y, y );

			}

			return;

		}

		const mark = ( ix, iz, h ) => {

			if ( ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz ) return;
			if ( floor ) this.insertFloor( ix, iz, h );
			else this.markSolid( ix, iz, h, h );

		};

		// Interior: centros de célula dentro do triângulo (projetado no plano XZ).
		const det = ( b.z - c.z ) * ( a.x - c.x ) + ( c.x - b.x ) * ( a.z - c.z );
		if ( Math.abs( det ) > 1e-9 ) {

			const x0 = Math.max( 0, Math.floor( ( Math.min( a.x, b.x, c.x ) - ox ) / s ) );
			const x1 = Math.min( this.nx - 1, Math.ceil( ( Math.max( a.x, b.x, c.x ) - ox ) / s ) );
			const z0 = Math.max( 0, Math.floor( ( Math.min( a.z, b.z, c.z ) - oz ) / s ) );
			const z1 = Math.min( this.nz - 1, Math.ceil( ( Math.max( a.z, b.z, c.z ) - oz ) / s ) );

			for ( let ix = x0; ix <= x1; ix ++ ) for ( let iz = z0; iz <= z1; iz ++ ) {

				const px = ox + ix * s, pz = oz + iz * s;
				const l0 = ( ( b.z - c.z ) * ( px - c.x ) + ( c.x - b.x ) * ( pz - c.z ) ) / det;
				const l1 = ( ( c.z - a.z ) * ( px - c.x ) + ( a.x - c.x ) * ( pz - c.z ) ) / det;
				const l2 = 1 - l0 - l1;
				if ( l0 < - 1e-4 || l1 < - 1e-4 || l2 < - 1e-4 ) continue;
				mark( ix, iz, l0 * a.y + l1 * b.y + l2 * c.y );

			}

		}

		// Arestas: pegam paredes verticais e peças finas que não cobrem nenhum centro de célula.
		for ( const [ p, q ] of [ [ a, b ], [ b, c ], [ c, a ] ] ) {

			const steps = Math.ceil( Math.hypot( q.x - p.x, q.z - p.z ) / ( s * 0.5 ) );
			for ( let i = 0; i <= steps; i ++ ) {

				const t = steps ? i / steps : 0;
				mark(
					Math.round( ( p.x + ( q.x - p.x ) * t - ox ) / s ),
					Math.round( ( p.z + ( q.z - p.z ) * t - oz ) / s ),
					p.y + ( q.y - p.y ) * t
				);

			}

		}

	}

	insertFloor( ix, iz, h ) {

		const H = this.heights, o = ( iz * this.nx + ix ) * LAYERS;
		let lowest = o;

		for ( let k = o; k < o + LAYERS; k ++ ) {

			if ( H[ k ] === NONE ) return void ( H[ k ] = h );
			if ( Math.abs( H[ k ] - h ) < MERGE ) return void ( H[ k ] = Math.max( H[ k ], h ) );
			if ( H[ k ] < H[ lowest ] ) lowest = k;

		}

		if ( h > H[ lowest ] ) H[ lowest ] = h;

	}

	markSolid( ix, iz, bottom, top ) {

		const o = ( iz * this.nx + ix ) * this.words;
		const b0 = Math.max( 0, Math.floor( ( bottom - this.minY ) / BIN ) );
		const b1 = Math.min( this.words * 32 - 1, Math.floor( ( top - this.minY ) / BIN ) );
		for ( let bin = b0; bin <= b1; bin ++ ) this.bins[ o + ( bin >> 5 ) ] |= 1 << ( bin & 31 );

	}

	// Libera um corredor: apaga os obstáculos de `height` metros acima do chão em toda célula onde
	// `inside(x, z)` é verdadeiro (usado na rampa, que passa por cima de enfeites do mapa).
	clearSolids( inside, groundAt, height ) {

		for ( let iz = 0; iz < this.nz; iz ++ ) for ( let ix = 0; ix < this.nx; ix ++ ) {

			const x = this.min.x + ix * this.cell, z = this.min.y + iz * this.cell;
			if ( ! inside( x, z ) ) continue;
			const o = ( iz * this.nx + ix ) * this.words;
			const g = groundAt( x, z );
			const b0 = Math.max( 0, Math.floor( ( g + 0.1 - this.minY ) / BIN ) );
			const b1 = Math.min( this.words * 32 - 1, Math.floor( ( g + height - this.minY ) / BIN ) );
			for ( let bin = b0; bin <= b1; bin ++ ) this.bins[ o + ( bin >> 5 ) ] &= ~ ( 1 << ( bin & 31 ) );

		}

	}

	cellOf( x, z ) {

		const ix = Math.round( ( x - this.min.x ) / this.cell );
		const iz = Math.round( ( z - this.min.y ) / this.cell );
		return ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz ? - 1 : iz * this.nx + ix;

	}

	// Superfície mais alta que fica no máximo `step` acima de `y` (o gramado conta como chão).
	floor( x, z, y, step ) {

		const i = this.cellOf( x, z );
		let best = this.base <= y + step ? this.base : NONE;
		if ( i < 0 ) return best;

		const H = this.heights, o = i * LAYERS;
		for ( let k = o; k < o + LAYERS; k ++ ) if ( H[ k ] <= y + step && H[ k ] > best ) best = H[ k ];
		return best;

	}

	// Tem algo sólido na célula entre as alturas `from` e `to`?
	solidBetween( x, z, from, to ) {

		const i = this.cellOf( x, z );
		if ( i < 0 || to <= from ) return false;

		const o = i * this.words;
		const b0 = Math.max( 0, Math.floor( ( from - this.minY ) / BIN ) );
		const b1 = Math.min( this.words * 32 - 1, Math.floor( ( to - this.minY ) / BIN ) );
		for ( let bin = b0; bin <= b1; bin ++ ) if ( this.bins[ o + ( bin >> 5 ) ] & ( 1 << ( bin & 31 ) ) ) return true;
		return false;

	}

	// Altura suave (bilinear) do chão sob (x, z), para apoiar carros e personagens.
	height( x, z, y, step ) {

		const center = this.floor( x, z, y, step );
		if ( center === NONE ) return NONE;

		const fx = ( x - this.min.x ) / this.cell, fz = ( z - this.min.y ) / this.cell;
		const ix = Math.floor( fx ), iz = Math.floor( fz );
		const tx = fx - ix, tz = fz - iz;
		const s = this.cell, ox = this.min.x, oz = this.min.y;

		const corner = ( cx, cz ) => {

			const h = this.floor( ox + cx * s, oz + cz * s, y, step );
			return Math.abs( h - center ) > step ? center : h;

		};

		const h00 = corner( ix, iz ), h10 = corner( ix + 1, iz ), h01 = corner( ix, iz + 1 ), h11 = corner( ix + 1, iz + 1 );
		return ( h00 * ( 1 - tx ) + h10 * tx ) * ( 1 - tz ) + ( h01 * ( 1 - tx ) + h11 * tx ) * tz;

	}

	// "Colisor" no mesmo formato das caixas (`containsPoint`), relativo à altura de quem se move:
	// atualize `y` antes de mover.
	// Um obstáculo só bloqueia se vem do chão (tem algo também entre 25 e 50 cm acima do chão
	// daquele ponto, como paredes, troncos e pilares). Enfeites flutuando sobre a pista — doces, faixas, arcos — são atravessados,
	// como na pista de kart original.
	blocker( { step, drop, height } ) {

		const terrain = this;
		return {
			y: 0,
			containsPoint( p ) {

				const y = this.y;
				const floor = terrain.floor( p.x, p.y, y, step );
				if ( floor < y - drop ) return true;

				const wall = ( x, z ) => terrain.solidBetween( x, z, y + step, y + height ) && terrain.solidBetween( x, z, floor + 0.25, floor + 0.5 );
				if ( ! wall( p.x, p.y ) ) return false;
				// Obstáculo de uma célula só (resto de enfeite, ponta de doce) não prende o carro.
				const c = terrain.cell;
				return wall( p.x + c, p.y ) || wall( p.x - c, p.y ) || wall( p.x, p.y + c ) || wall( p.x, p.y - c );

			},
		};

	}

}
