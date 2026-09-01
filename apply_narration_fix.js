// Helper script to apply the final narration sync fix
// Run with: node apply_narration_fix.js

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'app', 'page.tsx');

console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

// Find and replace the handleSetSpeed function's else block
const oldElseBlock = `    } else {
      if (simRef.current.narration) {
        simRef.current.narration.setEnabled(true);
        window.dispatchEvent(new CustomEvent('sim:narration-enabled', { detail: { enabled: true } }));
        const step = ALL_STEPS[simRef.current.getCurrentStep()];
        import('../lib/narrationScripts').then(({ getStepNarration }) => {
          const script = getStepNarration(step.id);
          simRef.current?.narration?.speak(\`Resuming narration at \${step.name}. \${script.starting}\`, 'high');
        });
      }
    }`;

const newElseBlock = `    } else {
      // Speed changed back to 1X: re-enable narration and sync to CURRENT LIVE POSITION
      if (simRef.current.narration) {
        simRef.current.narration.setEnabled(true);
        
        // Get the current live process step index from the simulation
        const currentStepIndex = simRef.current.getCurrentStep();
        const step = ALL_STEPS[currentStepIndex];
        
        // Update narration manager's position tracker
        simRef.current.narration.updateProcessPosition(currentStepIndex);
        
        // Clear the narrated steps ONLY for the current step and beyond
        // This allows the current step to be narrated when narration resumes
        const narratedSteps = simRef.current._narratedSteps;
        if (narratedSteps) {
          // Clear tracking for current and future steps so they can be narrated
          for (let i = currentStepIndex; i < ALL_STEPS.length; i++) {
            narratedSteps.delete(\`\${i}-arrive\`);
          }
        }
        
        window.dispatchEvent(new CustomEvent('sim:narration-enabled', { detail: { enabled: true } }));
        
        // Announce resumption at CURRENT step, not from beginning
        if (step) {
          import('../lib/narrationScripts').then(({ getStepNarration }) => {
            const script = getStepNarration(step.id);
            simRef.current?.narration?.speak(
              \`Resuming narration at \${step.name}. \${script.starting}\`, 
              'high'
            );
          });
        }
      }
    }`;

console.log('Applying fix...');
if (content.includes(oldElseBlock)) {
  content = content.replace(oldElseBlock, newElseBlock);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ Narration sync fix applied successfully!');
  console.log('The handleSetSpeed function now properly syncs to current process position.');
} else {
  console.log('❌ Could not find the target code block.');
  console.log('Please manually apply the fix from NARRATION_SYNC_FIX.md');
}
