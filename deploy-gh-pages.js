#!/usr/bin/env node

/**
 * GitHub Pages Deployment Script
 * 
 * Builds the app and deploys to gh-pages branch
 * Usage: npm run deploy
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, cpSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIST_DIR = join(__dirname, 'packages/app/dist');
const TEMP_DIR = join(__dirname, '.gh-pages-temp');

console.log('🚀 Starting GitHub Pages deployment...\n');

try {
  // Step 1: Clean and build
  console.log('📦 Building production version...');
  execSync('npm run clean', { stdio: 'inherit' });
  execSync('npm run build:core', { stdio: 'inherit' });
  execSync('npm run build:app', { stdio: 'inherit' });
  
  if (!existsSync(DIST_DIR)) {
    throw new Error('Build failed - dist directory not found');
  }
  
  console.log('✅ Build completed\n');
  
  // Step 2: Prepare gh-pages content
  console.log('📁 Preparing gh-pages branch...');
  
  // Get current branch
  const currentBranch = execSync('git branch --show-current').toString().trim();
  console.log(`Current branch: ${currentBranch}`);
  
  // Check for uncommitted changes
  const status = execSync('git status --porcelain').toString();
  if (status) {
    console.log('⚠️  Warning: You have uncommitted changes. Proceeding anyway...\n');
  }
  
  // Create temp directory
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEMP_DIR);
  
  // Copy dist files to temp
  cpSync(DIST_DIR, TEMP_DIR, { recursive: true });
  console.log('✅ Files copied to temp directory\n');
  
  // Step 3: Switch to gh-pages branch
  console.log('🌿 Switching to gh-pages branch...');
  
  try {
    // Try to checkout existing gh-pages branch
    execSync('git checkout gh-pages', { stdio: 'pipe' });
  } catch (e) {
    // Create new orphan branch if it doesn't exist
    console.log('Creating new gh-pages branch...');
    execSync('git checkout --orphan gh-pages', { stdio: 'inherit' });
  }
  
  // Step 4: Clean gh-pages branch
  console.log('🧹 Cleaning gh-pages branch...');
  execSync('git rm -rf . || true', { stdio: 'pipe' });
  
  // Step 5: Copy build files
  console.log('📋 Copying build files...');
  cpSync(TEMP_DIR, __dirname, { recursive: true });
  
  // Add .nojekyll to prevent Jekyll processing
  execSync('touch .nojekyll');
  
  // Step 6: Commit and push
  console.log('💾 Committing changes...');
  execSync('git add -A');
  
  try {
    execSync('git commit -m "Deploy to GitHub Pages"', { stdio: 'inherit' });
    
    console.log('\n📤 Pushing to gh-pages branch...');
    execSync('git push origin gh-pages --force', { stdio: 'inherit' });
    
    console.log('\n✅ Deployment successful!');
    console.log('\n🌐 Your site will be available at:');
    console.log('   https://username.github.io/open-ecg-generator/');
    console.log('\nNote: Replace "username" with your GitHub username');
  } catch (e) {
    console.log('No changes to deploy or push failed');
  }
  
  // Step 7: Return to original branch
  console.log(`\n↩️  Returning to ${currentBranch} branch...`);
  execSync(`git checkout ${currentBranch}`, { stdio: 'inherit' });
  
  // Cleanup
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  
  console.log('\n🎉 Done!\n');
  
} catch (error) {
  console.error('\n❌ Deployment failed:', error.message);
  
  // Try to return to original branch
  try {
    execSync('git checkout main || git checkout master', { stdio: 'pipe' });
  } catch (e) {
    // Ignore
  }
  
  // Cleanup
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  
  process.exit(1);
}

