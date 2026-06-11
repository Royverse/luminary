/**
 * js/systems/AnimationPose.js — Character kinematics + cape cloth sim.
 * Exported as a standalone function so Animation.js stays small.
 *
 * @ai-context
 *   OWNS      : ALL character pose logic (walk/jump/flight/stall/idle/braking);
 *               wing uniform time+boost updates; full cape cloth Verlet solver;
 *               body collider pushout (12 spheres, 10 iterations/frame).
 *   READS     : state.currentState, state.velocity, state.input, state.walkT,
 *               state.isStalling, state.isSprinting, state.isJumping,
 *               state.currentPitch, state.currentYaw, state.turnBank, state.simTime.
 *   WRITES    : state.walkT (increments during ground walk).
 *   MUTATES   : rig.* rotation/position fields; rig.particles[].pos;
 *               rig.wingUniforms.time / .boost;
 *               rig.cape.geometry.attributes.position.
 *   RELATED   : CharacterRig.js (defines rig structure, SEGS_W/H, particles,
 *               constraints, proxies, colliders — MUST read before editing cloth);
 *               PlayerState.js (state fields); Animation.js (calls this each frame).
 *   ASK FOR   : CharacterRig.js + PlayerState.js before editing pose or cloth.
 */
import { clamp, expDecay, wrapAngle } from '../main.js';

export function updateCharacterPose(dt, time, state, rig) {
    const S   = state.STATES;
    const st  = state.currentState;
    const ease = (cur, tgt, k) => cur + (tgt - cur) * expDecay(k, dt);
    const isBraking  = state.input.brake;
    const isBoosting = state.input.boost && !state.isStalling;
    const isSuper = st === S.SUPERSONIC, isDive = st === S.POWERDIVE;
    const isStall = st === S.STALL,      isIdle = st === S.IDLE;
    const isWalk  = st === S.WALK;

    // Wings
    if (rig.wingUniforms) {
        rig.wingUniforms.time.value  = time;
        rig.wingUniforms.boost.value = ease(rig.wingUniforms.boost.value, isBoosting ? 1 : 0, 4);
    }

    // Body tilt
    if (rig.bodyPivot) {
        const tgt = (isIdle || isWalk || state.isJumping) ? 0 : -Math.PI/2;
        rig.bodyPivot.rotation.x = ease(rig.bodyPivot.rotation.x, tgt, isWalk ? 12 : 3.5);
    }

    // Eye glow + chest emblem pulse (emblem breathes with flight intensity)
    if (rig.eyeL && rig.eyeR) {
        const ei = isSuper?6:isDive?8:isStall?0.8:(isIdle||isWalk)?2:3;
        rig.eyeL.material.emissiveIntensity = ease(rig.eyeL.material.emissiveIntensity, ei, 4);
        rig.eyeR.material.emissiveIntensity = rig.eyeL.material.emissiveIntensity;
        if (rig.emblem) {
            rig.emblem.material.emissiveIntensity =
                0.8 + rig.eyeL.material.emissiveIntensity * 0.4 + Math.sin(time * 2.2) * 0.2;
        }
    }

    const HIP_H=0.96, aL=rig.armL, aR=rig.armR, lL=rig.legL, lR=rig.legR;
    const isMovingOnGround = isWalk && (Math.abs(state.velocity.x)>1||Math.abs(state.velocity.z)>1);

    if (isMovingOnGround && !state.isJumping) state.walkT += dt*(state.isSprinting?17:10.5);
    const sin=Math.sin(state.walkT), cos=Math.cos(state.walkT);
    const lerpK = isMovingOnGround ? 14 : 8;

    if (isWalk) {
        const legA=state.isSprinting?1.05:0.72, armA=state.isSprinting?0.80:0.55;
        rig.chest.rotation.x = ease(rig.chest.rotation.x, state.isSprinting?-0.12:0, 10);

        if (isMovingOnGround) {
            lL.thighPivot.rotation.x = ease(lL.thighPivot.rotation.x,  sin*legA, lerpK);
            lR.thighPivot.rotation.x = ease(lR.thighPivot.rotation.x, -sin*legA, lerpK);
            lL.kneePivot.rotation.x  = ease(lL.kneePivot.rotation.x,  Math.max(0, sin)*(state.isSprinting?1.7:1.2), lerpK);
            lR.kneePivot.rotation.x  = ease(lR.kneePivot.rotation.x,  Math.max(0,-sin)*(state.isSprinting?1.7:1.2), lerpK);
            lL.footPivot.rotation.x  = ease(lL.footPivot.rotation.x, -lL.kneePivot.rotation.x*0.45-sin*0.15, lerpK);
            lR.footPivot.rotation.x  = ease(lR.footPivot.rotation.x, -lR.kneePivot.rotation.x*0.45+sin*0.15, lerpK);
            aL.shoulderPivot.rotation.x = ease(aL.shoulderPivot.rotation.x, -sin*armA, lerpK);
            aR.shoulderPivot.rotation.x = ease(aR.shoulderPivot.rotation.x,  sin*armA, lerpK);
            aL.elbowPivot.rotation.x = ease(aL.elbowPivot.rotation.x, -0.08+Math.max(0, sin)*-0.5, lerpK);
            aR.elbowPivot.rotation.x = ease(aR.elbowPivot.rotation.x, -0.08+Math.max(0,-sin)*-0.5, lerpK);
        } else {
            lL.thighPivot.rotation.x=ease(lL.thighPivot.rotation.x,0,lerpK);
            lR.thighPivot.rotation.x=ease(lR.thighPivot.rotation.x,0,lerpK);
            lL.kneePivot.rotation.x=ease(lL.kneePivot.rotation.x,0,lerpK);
            lR.kneePivot.rotation.x=ease(lR.kneePivot.rotation.x,0,lerpK);
            lL.footPivot.rotation.x=ease(lL.footPivot.rotation.x,0,lerpK);
            lR.footPivot.rotation.x=ease(lR.footPivot.rotation.x,0,lerpK);
            aL.shoulderPivot.rotation.x=ease(aL.shoulderPivot.rotation.x,0,lerpK);
            aR.shoulderPivot.rotation.x=ease(aR.shoulderPivot.rotation.x,0,lerpK);
            aL.elbowPivot.rotation.x=ease(aL.elbowPivot.rotation.x,-0.06,lerpK);
            aR.elbowPivot.rotation.x=ease(aR.elbowPivot.rotation.x,-0.06,lerpK);
        }
        aL.shoulderPivot.rotation.z=ease(aL.shoulderPivot.rotation.z, 0.12,8);
        aR.shoulderPivot.rotation.z=ease(aR.shoulderPivot.rotation.z,-0.12,8);

        const hipBob  = isMovingOnGround ? Math.abs(cos)*(state.isSprinting?0.12:0.06) : 0;
        const hipTwist= isMovingOnGround ? sin*(state.isSprinting?0.25:0.18) : 0;
        const hipTilt = isMovingOnGround ? -cos*0.07 : 0;
        rig.hips.position.y=ease(rig.hips.position.y, HIP_H+hipBob, 12);
        rig.hips.rotation.y=ease(rig.hips.rotation.y, hipTwist, 12);
        rig.hips.rotation.z=ease(rig.hips.rotation.z, hipTilt, 12);

        const chestTwist=isMovingOnGround?-sin*(state.isSprinting?0.35:0.25):0;
        rig.chest.rotation.y=ease(rig.chest.rotation.y, chestTwist, 12);
        rig.chest.rotation.z=ease(rig.chest.rotation.z, isMovingOnGround?cos*0.06:0, 12);
        rig.neckPivot.rotation.y=ease(rig.neckPivot.rotation.y,-(rig.hips.rotation.y+rig.chest.rotation.y),12);
        rig.neckPivot.rotation.z=ease(rig.neckPivot.rotation.z,-(rig.hips.rotation.z+rig.chest.rotation.z),12);

        if (!isMovingOnGround) {
            const breath=Math.sin(time*1.4)*0.012;
            rig.chest.rotation.z=ease(rig.chest.rotation.z,breath,4);
            rig.hips.position.y=ease(rig.hips.position.y,HIP_H+Math.sin(time*1.4)*0.008,4);
        }
        rig.headPivot.rotation.x=ease(rig.headPivot.rotation.x,0,8);
        rig.headPivot.rotation.y=ease(rig.headPivot.rotation.y,0,8);

    } else if (state.isJumping) {
        const tuck=Math.min(1,Math.abs(state.velocity.y)/state.jumpForce*1.4);
        const legTuck=state.velocity.y>0?0.55*tuck:-0.25*tuck;
        lL.thighPivot.rotation.x=ease(lL.thighPivot.rotation.x,legTuck+0.1,16);
        lR.thighPivot.rotation.x=ease(lR.thighPivot.rotation.x,legTuck+0.1,16);
        lL.kneePivot.rotation.x=ease(lL.kneePivot.rotation.x,state.velocity.y>0?1.0:0.2,16);
        lR.kneePivot.rotation.x=ease(lR.kneePivot.rotation.x,state.velocity.y>0?1.0:0.2,16);
        lL.footPivot.rotation.x=ease(lL.footPivot.rotation.x,-0.4,12);
        lR.footPivot.rotation.x=ease(lR.footPivot.rotation.x,-0.4,12);
        aL.shoulderPivot.rotation.x=ease(aL.shoulderPivot.rotation.x,-0.3,12);
        aR.shoulderPivot.rotation.x=ease(aR.shoulderPivot.rotation.x,-0.3,12);
        aL.shoulderPivot.rotation.z=ease(aL.shoulderPivot.rotation.z,0.4,12);
        aR.shoulderPivot.rotation.z=ease(aR.shoulderPivot.rotation.z,-0.4,12);
        aL.elbowPivot.rotation.x=ease(aL.elbowPivot.rotation.x,-0.3,12);
        aR.elbowPivot.rotation.x=ease(aR.elbowPivot.rotation.x,-0.3,12);
        rig.chest.rotation.x=ease(rig.chest.rotation.x,-0.15,12);
        rig.hips.position.y=ease(rig.hips.position.y,HIP_H,12);
        rig.hips.rotation.set(0,0,0); rig.neckPivot.rotation.set(0,0,0);

    } else {
        let szL=0.12,szR=-0.12,sxL=0,sxR=0,exL=-0.06,exR=-0.06;
        let hxL=0,hxR=0,kxL=0,kxR=0,fxL=0,fxR=0;

        if (isIdle) {
            // Hover: relaxed limbs with slow asymmetric drift so it reads alive
            szL=0.4;szR=-0.4;
            sxL=-0.2+Math.sin(time*0.9)*0.05; sxR=-0.2+Math.cos(time*0.8)*0.05;
            exL=-0.1;exR=-0.1;
            hxL=0.1+Math.sin(time*0.7)*0.035; hxR=0.1+Math.cos(time*0.65)*0.035;
        }
        else if (isSuper) {
            // Classic one-fist lead: left arm punched forward, right tucked at side
            szL=0.05;szR=-0.22;
            sxL=-Math.PI*0.95;sxR=0.35;
            exL=0;exR=-0.55;
            hxL=0.05;hxR=0.16;
            fxL=0.45;fxR=0.45;
        }
        else if (isDive)    { szL=0.1;szR=-0.1;sxL=0.2;sxR=0.2;exL=-1.2;exR=-1.2;fxL=0.3;fxR=0.3; }
        else if (isStall)   {
            szL=1.3;szR=-1.3;
            sxL=-0.9-Math.sin(time*8.5)*0.4; sxR=-0.9-Math.cos(time*7.8)*0.4;
            exL=-0.9-Math.sin(time*8.5)*0.4; exR=-0.9-Math.cos(time*7.8)*0.4;
            hxL=-Math.sin(time*6.2)*0.5; hxR=-Math.cos(time*5.7)*0.5;
            kxL=-0.45-Math.sin(time*7.3)*0.35; kxR=-0.45-Math.cos(time*6.8)*0.35;
        } else if (isBraking){ szL=1.3;szR=-1.3;sxL=-1.2;sxR=-1.2;exL=-0.2;exR=-0.2;hxL=0.3;hxR=0.3;kxL=-0.4;kxR=-0.4; }
        else {
            // Cruise flight: arms swept back, slightly staggered, with gentle drift
            szL=0.28;szR=-0.32;
            sxL=-0.35+Math.sin(time*1.1)*0.04; sxR=-0.5+Math.cos(time*1.0)*0.04;
            exL=-0.25;exR=-0.15;
            hxL=0.04;hxR=0.1;
            fxL=0.35;fxR=0.35;
        }

        const r=isStall?10:6;
        aL.shoulderPivot.rotation.z=ease(aL.shoulderPivot.rotation.z,szL,r);
        aR.shoulderPivot.rotation.z=ease(aR.shoulderPivot.rotation.z,szR,r);
        aL.shoulderPivot.rotation.x=ease(aL.shoulderPivot.rotation.x,sxL,r);
        aR.shoulderPivot.rotation.x=ease(aR.shoulderPivot.rotation.x,sxR,r);
        aL.elbowPivot.rotation.x=ease(aL.elbowPivot.rotation.x,exL,r);
        aR.elbowPivot.rotation.x=ease(aR.elbowPivot.rotation.x,exR,r);
        lL.thighPivot.rotation.x=ease(lL.thighPivot.rotation.x,hxL,r);
        lR.thighPivot.rotation.x=ease(lR.thighPivot.rotation.x,hxR,r);
        lL.kneePivot.rotation.x=ease(lL.kneePivot.rotation.x,kxL,r);
        lR.kneePivot.rotation.x=ease(lR.kneePivot.rotation.x,kxR,r);
        lL.footPivot.rotation.x=ease(lL.footPivot.rotation.x,fxL,r);
        lR.footPivot.rotation.x=ease(lR.footPivot.rotation.x,fxR,r);
        rig.hips.position.y=ease(rig.hips.position.y,HIP_H,r);
        // Torso eases home instead of hard-resetting; chest leans into banked turns
        const lean = (isIdle||isStall) ? 0 : state.turnBank*0.22;
        rig.hips.rotation.x=ease(rig.hips.rotation.x,0,r);
        rig.hips.rotation.y=ease(rig.hips.rotation.y,0,r);
        rig.hips.rotation.z=ease(rig.hips.rotation.z,0,r);
        rig.chest.rotation.x=ease(rig.chest.rotation.x,0,r);
        rig.chest.rotation.y=ease(rig.chest.rotation.y,0,r);
        rig.chest.rotation.z=ease(rig.chest.rotation.z,lean,5);
        rig.neckPivot.rotation.x=ease(rig.neckPivot.rotation.x,0,r);
        rig.neckPivot.rotation.y=ease(rig.neckPivot.rotation.y,0,r);
        rig.neckPivot.rotation.z=ease(rig.neckPivot.rotation.z,-lean*0.6,5);

        let hp=0,hy=0;
        if (isWalk||isIdle||state.isJumping) {
            hp=clamp(state.currentPitch*0.45,-0.4,0.4);
            hy=clamp(wrapAngle(state.currentYaw-rig.player.rotation.y)*0.5,-0.8,0.8);
            if (isIdle){ hp+=Math.sin(time*0.6)*0.05; hy+=Math.sin(time*0.4)*0.1; }
        } else {
            hp=Math.PI/2;
            if (isDive) hp=Math.PI/2.5;
            else if (isStall){ hp=0; hy=Math.sin(time*4.5)*0.35; }
            else if (isBraking) hp=Math.PI/2.2;
            hy+=state.turnBank*0.5;
        }
        rig.headPivot.rotation.x=ease(rig.headPivot.rotation.x,hp,6);
        rig.headPivot.rotation.y=ease(rig.headPivot.rotation.y,hy,6);
    }

    // Cape cloth simulation
    if (rig.cape && rig.particles) {
        const ts=Math.min(dt,0.025), pv=rig.proxyVecs;
        rig.leftPin.getWorldPosition(pv.wL); rig.rightPin.getWorldPosition(pv.wR);
        const SW=rig.SEGS_W;
        for (let x=0;x<=SW;x++) {
            const t=x/SW;
            rig.particles[x].pos.lerpVectors(pv.wR,pv.wL,t);
            rig.particles[x].prev.copy(rig.particles[x].pos);
        }
        const vel=state.velocity;
        let wX=-vel.x*0.3+Math.sin(state.simTime*1.1)*0.4;
        let wZ=-vel.z*0.3+Math.cos(state.simTime*0.9)*0.4;
        let wY=-vel.y*0.3;
        if (isWalk&&state.isSprinting){ wX*=1.5;wZ*=1.5;wY-=0.5; }
        if (isSuper){ wX*=2.5;wZ*=2.5;wY*=2.5; }
        const grav=-14, ts2=ts*ts, n=rig.particles.length;
        for (let i=SW+1;i<n;i++) {
            const p=rig.particles[i];
            if (!isFinite(p.pos.x)||!isFinite(p.pos.y)||!isFinite(p.pos.z)){
                const pinT=(i%(SW+1))/SW;
                p.pos.lerpVectors(pv.wR,pv.wL,pinT); p.prev.copy(p.pos); continue;
            }
            const vx=(p.pos.x-p.prev.x)*0.97,vy=(p.pos.y-p.prev.y)*0.97,vz=(p.pos.z-p.prev.z)*0.97;
            p.prev.copy(p.pos);
            p.pos.x+=vx+wX*ts2; p.pos.y+=vy+(grav+wY)*ts2; p.pos.z+=vz+wZ*ts2;
            if(p.pos.y<0.05){p.pos.y=0.05;p.prev.y=0.05;}
        }
        rig.proxies.neck.getWorldPosition(pv.wNeck);
        rig.proxies.spineT.getWorldPosition(pv.wSpineT);
        rig.proxies.spineM.getWorldPosition(pv.wSpineM);
        rig.proxies.waist.getWorldPosition(pv.wWaist);
        rig.proxies.hip.getWorldPosition(pv.wHip);
        rig.proxies.hipLow.getWorldPosition(pv.wHipLow);
        rig.proxies.shL.getWorldPosition(pv.wShL); rig.proxies.shR.getWorldPosition(pv.wShR);
        rig.proxies.calfL.getWorldPosition(pv.wCalfL); rig.proxies.calfR.getWorldPosition(pv.wCalfR);
        rig.proxies.calfLL.getWorldPosition(pv.wCalfLL); rig.proxies.calfRL.getWorldPosition(pv.wCalfRL);
        const pushOut=(pos,c,r)=>{
            const dx=pos.x-c.x,dy=pos.y-c.y,dz=pos.z-c.z;
            const d=Math.sqrt(dx*dx+dy*dy+dz*dz);
            if(d>0&&d<r){const push=(r-d)/d;pos.x+=dx*push;pos.y+=dy*push;pos.z+=dz*push;}
        };
        for(let iter=0;iter<10;iter++){
            for(let i=SW+1;i<n;i++){
                const pos=rig.particles[i].pos;
                for(let c=0;c<rig.colliders.length;c++) pushOut(pos,rig.colliders[c][0],rig.colliders[c][1]);
            }
            const cLen=rig.constraints.length;
            for(let c=0;c<cLen;c+=3){
                const i1=rig.constraints[c],i2=rig.constraints[c+1],rest=rig.constraints[c+2];
                const p1=rig.particles[i1],p2=rig.particles[i2];
                pv.diff.subVectors(p2.pos,p1.pos);
                const dist=pv.diff.length(); if(dist<1e-6)continue;
                const factor=(1-rest/dist)*0.5;
                if(!p1.pinned){p1.pos.x+=pv.diff.x*factor;p1.pos.y+=pv.diff.y*factor;p1.pos.z+=pv.diff.z*factor;}
                if(!p2.pinned){p2.pos.x-=pv.diff.x*factor;p2.pos.y-=pv.diff.y*factor;p2.pos.z-=pv.diff.z*factor;}
            }
        }
        const arr=rig.cape.geometry.attributes.position.array;
        for(let i=0;i<n;i++){arr[i*3]=rig.particles[i].pos.x;arr[i*3+1]=rig.particles[i].pos.y;arr[i*3+2]=rig.particles[i].pos.z;}
        rig.cape.geometry.attributes.position.needsUpdate=true;
        rig.cape.geometry.computeVertexNormals();
    }
}
