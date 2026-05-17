/**
 * js/entities/CharacterRig.js — Humanoid mesh, energy wings, cape cloth.
 *
 * @ai-context
 *   OWNS      : ALL Three.js mesh objects for the player character;
 *               GLSL wing vertex + fragment shaders; wingUniforms;
 *               cape cloth particle grid + constraint list + proxy colliders.
 *   READS     : state.totalRings (unused directly, kept for potential future use).
 *   WRITES    : nothing to PlayerState.
 *   EXPOSES   : player, bodyPivot, hips, chest, neckPivot, headPivot,
 *               eyeL, eyeR, armL, armR, legL, legR,
 *               wingL, wingR, wingUniforms,
 *               cape, particles, constraints, SEGS_W, SEGS_H,
 *               leftPin, rightPin, proxies, proxyVecs, colliders, charScale.
 *   RELATED   : AnimationPose.js (reads ALL fields above every frame);
 *               Animation.js (uses rig.player.position for trail/shockwave).
 *   ASK FOR   : AnimationPose.js if you need to understand how rig fields are used.
 */
import * as THREE from 'three';

function bone(geo, mat, pivotY) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mat);
    m.position.y = pivotY;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return g;
}

export class CharacterRig {
    constructor(scene, state) {
        this.scene = scene;
        this.state = state;
        this.charScale = 1.65;
        this._buildCharacter();
        this._buildWings();
        this._buildCape();
    }

    _buildCharacter() {
        const M = {
            skin:  new THREE.MeshStandardMaterial({ color: 0xffcba4, roughness: 0.5,  metalness: 0.05 }),
            shirt: new THREE.MeshStandardMaterial({ color: 0x2f80c0, roughness: 0.85 }),
            pants: new THREE.MeshStandardMaterial({ color: 0x23303f, roughness: 0.9  }),
            shoes: new THREE.MeshStandardMaterial({ color: 0xf0ede8, roughness: 0.6  }),
            hair:  new THREE.MeshStandardMaterial({ color: 0x251510, roughness: 0.95 }),
            eye:   new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }),
            sole:  new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9  }),
        };
        const HIP_H=0.96, THIGH_H=0.44, CALF_H=0.44, TORSO_H=0.50, NECK_H=0.10, HEAD_R=0.14;

        this.player = new THREE.Group(); this.scene.add(this.player);
        this.bodyPivot = new THREE.Group(); this.player.add(this.bodyPivot);

        this.hips = new THREE.Group(); this.hips.position.y = HIP_H; this.bodyPivot.add(this.hips);
        this.hips.add(bone(new THREE.CylinderGeometry(0.16,0.18,0.18,16), M.pants, -0.09));

        this.chest = new THREE.Group(); this.hips.add(this.chest);
        this.chest.add(bone(new THREE.CylinderGeometry(0.19,0.17,TORSO_H,16), M.shirt, TORSO_H/2));
        const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.175,0.175,0.04,16), M.shirt);
        hem.castShadow = true; this.chest.add(hem);

        this.neckPivot = new THREE.Group(); this.neckPivot.position.y = TORSO_H; this.chest.add(this.neckPivot);
        this.neckPivot.add(bone(new THREE.CylinderGeometry(0.055,0.065,NECK_H*2,12), M.skin, NECK_H));

        this.headPivot = new THREE.Group(); this.headPivot.position.y = NECK_H*2; this.neckPivot.add(this.headPivot);
        const hm = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R,32,24), M.skin);
        hm.position.y = HEAD_R; hm.castShadow = true; this.headPivot.add(hm);
        const jaw = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R*0.88,20,16), M.skin);
        jaw.scale.y=0.72; jaw.position.set(0,HEAD_R*0.55,HEAD_R*0.04); this.headPivot.add(jaw);
        const hairCap = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R+0.008,24,16,0,Math.PI*2,0,Math.PI*0.56), M.hair);
        hairCap.position.y = HEAD_R; this.headPivot.add(hairCap);

        const buildEye = side => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022,12,12), M.eye.clone());
            eye.position.set(side*0.065, HEAD_R*1.1, -HEAD_R*0.88);
            const sc = new THREE.Mesh(new THREE.SphereGeometry(0.028,12,12), new THREE.MeshStandardMaterial({color:0xffffff}));
            sc.position.copy(eye.position); sc.position.z += 0.006;
            this.headPivot.add(eye, sc); return eye;
        };
        this.eyeL = buildEye(1); this.eyeR = buildEye(-1);

        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025,10,8), M.skin);
        nose.position.set(0,HEAD_R*0.95,-HEAD_R*1.05); this.headPivot.add(nose);
        [-1,1].forEach(s => {
            const ear = new THREE.Mesh(new THREE.SphereGeometry(0.028,8,8), M.skin);
            ear.scale.z=0.45; ear.position.set(s*(HEAD_R+0.012),HEAD_R*1.0,0); this.headPivot.add(ear);
        });

        const buildLeg = side => {
            const tp = new THREE.Group(); tp.position.set(side*0.095,0,0); this.hips.add(tp);
            tp.add(bone(new THREE.CylinderGeometry(0.095,0.078,THIGH_H,14), M.pants, -THIGH_H/2));
            const kp = new THREE.Group(); kp.position.y = -THIGH_H; tp.add(kp);
            const kc = new THREE.Mesh(new THREE.SphereGeometry(0.075,12,10), M.pants); kc.castShadow=true; kp.add(kc);
            kp.add(bone(new THREE.CylinderGeometry(0.072,0.055,CALF_H,14), M.skin, -CALF_H/2));
            const fp = new THREE.Group(); fp.position.y = -CALF_H; kp.add(fp);
            const sb = new THREE.Mesh(new THREE.BoxGeometry(0.13,0.09,0.28), M.shoes);
            sb.position.set(0,-0.045,0.055); sb.castShadow=true; fp.add(sb);
            const sl = new THREE.Mesh(new THREE.BoxGeometry(0.135,0.025,0.285), M.sole);
            sl.position.set(0,-0.1,0.055); sl.castShadow=true; fp.add(sl);
            const to = new THREE.Mesh(new THREE.SphereGeometry(0.068,12,8), M.shoes);
            to.scale.set(1,0.65,1.05); to.position.set(0,-0.04,0.175); to.castShadow=true; fp.add(to);
            return { thighPivot:tp, kneePivot:kp, footPivot:fp };
        };
        this.legL = buildLeg(1); this.legR = buildLeg(-1);

        const buildArm = side => {
            const UPPER_H=0.30, LOWER_H=0.26;
            const sp = new THREE.Group(); sp.position.set(side*0.22, TORSO_H-0.04, 0); this.chest.add(sp);
            const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075,12,10), M.shirt); cap.castShadow=true; sp.add(cap);
            sp.add(bone(new THREE.CylinderGeometry(0.068,0.058,UPPER_H,12), M.shirt, -UPPER_H/2));
            const ep = new THREE.Group(); ep.position.y = -UPPER_H; sp.add(ep);
            const eb = new THREE.Mesh(new THREE.SphereGeometry(0.055,10,8), M.skin); eb.castShadow=true; ep.add(eb);
            ep.add(bone(new THREE.CylinderGeometry(0.052,0.042,LOWER_H,12), M.skin, -LOWER_H/2));
            const hp = new THREE.Group(); hp.position.y = -LOWER_H; ep.add(hp);
            const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075,0.095,0.055), M.skin);
            hand.position.y=-0.048; hand.castShadow=true; hp.add(hand);
            sp.rotation.z = side*0.12;
            return { shoulderPivot:sp, elbowPivot:ep, handPivot:hp };
        };
        this.armL = buildArm(1); this.armR = buildArm(-1);
        this.player.scale.setScalar(this.charScale);
    }

    _buildWings() {
        const cs = this.charScale, SEGS = 16;
        const pos = new Float32Array((SEGS+1)*2*3);
        const uv  = new Float32Array((SEGS+1)*2*2);
        const idx = [];
        for (let i = 0; i <= SEGS; i++) {
            const t = i/SEGS;
            pos[i*6+0]=t*2.5*cs; pos[i*6+1]=Math.sin(t*2.0)*0.5*cs; pos[i*6+2]=0;
            pos[i*6+3]=t*2.2*cs; pos[i*6+4]=-1.2*cs+Math.cos(t*1.5)*0.3*cs; pos[i*6+5]=-0.2*cs;
            uv[i*4+0]=t; uv[i*4+1]=1; uv[i*4+2]=t; uv[i*4+3]=0;
            if (i<SEGS) { const b=i*2; idx.push(b,b+1,b+2,b+1,b+3,b+2); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
        geo.setAttribute('uv',       new THREE.BufferAttribute(uv,2));
        geo.setIndex(idx);

        this.wingUniforms = {
            time:  { value: 0 },
            boost: { value: 0 },
            color: { value: new THREE.Color(0x00f0ff) },
        };
        const mat = new THREE.ShaderMaterial({
            uniforms: this.wingUniforms, transparent:true, side:THREE.DoubleSide,
            blending:THREE.AdditiveBlending, depthWrite:false,
            vertexShader:`
                varying vec2 vUv; uniform float time; uniform float boost;
                void main(){vUv=uv;vec3 p=position;float flap=sin(time*12.0)*0.15*(1.0-boost);
                p.z+=flap*vUv.x*2.0;p.z-=boost*vUv.x*3.0;p.x*=(1.0+boost*0.4);
                gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
            fragmentShader:`
                varying vec2 vUv; uniform float time; uniform float boost; uniform vec3 color;
                void main(){float edge=1.0-vUv.x;
                float glow=pow(edge,1.5)*(0.5+0.5*sin(vUv.x*10.0-time*5.0));
                float alpha=glow*smoothstep(0.0,0.1,vUv.y)*smoothstep(1.0,0.9,vUv.y);
                alpha*=(0.4+boost*0.6);vec3 c=mix(color,vec3(1.0,0.2,0.5),boost*vUv.x);
                gl_FragColor=vec4(c,alpha);}`,
        });
        this.wingL = new THREE.Mesh(geo, mat); this.wingR = new THREE.Mesh(geo, mat);
        this.wingR.scale.set(-1,1,1);
        this.wingL.position.set( 0.08*cs,0.45*cs,-0.05*cs);
        this.wingR.position.set(-0.08*cs,0.45*cs,-0.05*cs);
        this.chest.add(this.wingL, this.wingR);
    }

    _buildCape() {
        const cs=this.charScale, SEGS_W=14, SEGS_H=16;
        this.SEGS_W=SEGS_W; this.SEGS_H=SEGS_H;
        const CLOTH_W=1.05*cs, CLOTH_H=1.5*cs;
        const restW=CLOTH_W/SEGS_W, restH=CLOTH_H/SEGS_H, restD=Math.hypot(restW,restH);
        const NECK_TOP_Y = 0.96+0.50+0.10*2; // HIP_H+TORSO_H+NECK_H*2

        this.particles=[];
        for(let y=0;y<=SEGS_H;y++) for(let x=0;x<=SEGS_W;x++) {
            const px=(x/SEGS_W-0.5)*CLOTH_W, py=NECK_TOP_Y-y*restH, pz=-0.22;
            this.particles.push({pos:new THREE.Vector3(px,py,pz),prev:new THREE.Vector3(px,py,pz),pinned:y===0});
        }

        this.constraints=[];
        for(let y=0;y<=SEGS_H;y++) for(let x=0;x<=SEGS_W;x++) {
            const i=y*(SEGS_W+1)+x;
            if(x<SEGS_W) this.constraints.push(i,i+1,restW);
            if(y<SEGS_H) this.constraints.push(i,i+(SEGS_W+1),restH);
            if(x<SEGS_W&&y<SEGS_H){ this.constraints.push(i,i+1+(SEGS_W+1),restD); this.constraints.push(i+1,i+(SEGS_W+1),restD); }
        }

        const capeGeo=new THREE.BufferGeometry();
        const cpArr=new Float32Array(this.particles.length*3);
        const uvArr=new Float32Array(this.particles.length*2);
        const ci=[];
        for(let y=0;y<=SEGS_H;y++) for(let x=0;x<=SEGS_W;x++){
            uvArr[(y*(SEGS_W+1)+x)*2]=x/SEGS_W; uvArr[(y*(SEGS_W+1)+x)*2+1]=1-y/SEGS_H;
        }
        for(let y=0;y<SEGS_H;y++) for(let x=0;x<SEGS_W;x++){
            const i=x+y*(SEGS_W+1); ci.push(i,i+1,i+(SEGS_W+1)); ci.push(i+1,i+1+(SEGS_W+1),i+(SEGS_W+1));
        }
        capeGeo.setIndex(ci);
        capeGeo.setAttribute('position',new THREE.BufferAttribute(cpArr,3));
        capeGeo.setAttribute('uv',new THREE.BufferAttribute(uvArr,2));
        this.cape=new THREE.Mesh(capeGeo,new THREE.MeshStandardMaterial({color:0xcc0033,roughness:0.75,metalness:0.04,side:THREE.DoubleSide}));
        this.cape.frustumCulled=false; this.scene.add(this.cape);

        this.leftPin=new THREE.Object3D(); this.leftPin.position.set(0.13,0.05,-0.14); this.neckPivot.add(this.leftPin);
        this.rightPin=new THREE.Object3D(); this.rightPin.position.set(-0.13,0.05,-0.14); this.neckPivot.add(this.rightPin);

        const mk=(parent,px,py,pz)=>{const o=new THREE.Object3D();o.position.set(px,py,pz);parent.add(o);return o;};
        const T=0.50;
        this.proxies={
            neck:  mk(this.chest,0,T*0.92,-0.10), spineT:mk(this.chest,0,T*0.65,-0.18),
            spineM:mk(this.chest,0,T*0.35,-0.17), waist: mk(this.chest,0,T*0.05,-0.14),
            hip:   mk(this.hips,0,-0.04,-0.16),   hipLow:mk(this.hips,0,-0.16,-0.10),
            shL:   mk(this.chest,0.20,T*0.88,-0.08), shR:mk(this.chest,-0.20,T*0.88,-0.08),
            calfL: mk(this.legL.kneePivot,0,-0.44*0.35,-0.07), calfR:mk(this.legR.kneePivot,0,-0.44*0.35,-0.07),
            calfLL:mk(this.legL.kneePivot,0,-0.44*0.75,-0.05), calfRL:mk(this.legR.kneePivot,0,-0.44*0.75,-0.05),
        };
        this.proxyVecs={
            wL:new THREE.Vector3(),wR:new THREE.Vector3(),wNeck:new THREE.Vector3(),wSpineT:new THREE.Vector3(),
            wSpineM:new THREE.Vector3(),wWaist:new THREE.Vector3(),wHip:new THREE.Vector3(),wHipLow:new THREE.Vector3(),
            wShL:new THREE.Vector3(),wShR:new THREE.Vector3(),wCalfL:new THREE.Vector3(),wCalfR:new THREE.Vector3(),
            wCalfLL:new THREE.Vector3(),wCalfRL:new THREE.Vector3(),diff:new THREE.Vector3(),
        };
        const pv=this.proxyVecs;
        this.colliders=[
            [pv.wNeck,0.16*cs],[pv.wSpineT,0.27*cs],[pv.wSpineM,0.25*cs],[pv.wWaist,0.22*cs],
            [pv.wHip,0.27*cs],[pv.wHipLow,0.22*cs],[pv.wShL,0.16*cs],[pv.wShR,0.16*cs],
            [pv.wCalfL,0.15*cs],[pv.wCalfR,0.15*cs],[pv.wCalfLL,0.13*cs],[pv.wCalfRL,0.13*cs],
        ];
    }
}
