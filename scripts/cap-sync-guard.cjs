#!/usr/bin/env node
'use strict';
try{require('./native-artifact.cjs').inspect(require('node:path').resolve(__dirname,'..'));}
catch(error){console.error('[native-copy-guard] '+error.message);process.exitCode=1;}
