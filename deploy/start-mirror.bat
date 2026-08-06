@echo off
REM Starts the MirrorOS backend. Repo root is resolved from this script's own
REM location, so the checkout can live anywhere.
cd /d "%~dp0.."
node server\index.js
