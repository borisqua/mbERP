"use strict";

const
  Net = require('net')
  , cli = require('commander')
  , {EBMLReader, OVReader, Stimuli, Epochs, DSVProcessor, DSHProcessor, Classifier, Stringifier, /*NTVerdictStringifier, Objectifier,*/ Tools} = require('mbeeg')
  , config = Tools.loadConfiguration(`config.json`)
  , plainStringifier = new Stringifier({
    chunkEnd: `\r\n`
  })
  , verdictStringifier = new Stringifier({
    chunkBegin: `{"verdict":`
    , chunkEnd: `}\r\n`
  })
  // , ntrainerStringifier = new NTVerdictStringifier({
  //   chunkBegin: `{\n"class": "ru.itu.parcus.modules.neurotrainer.modules.mbeegxchg.dto.MbeegEventClassifierResult",
  //   "cells": [`
  //   , chunkEnd: `]}\n`
  //   , chunksDelimiter: `,`
  //   , indentationSpace: 2
  //   , stringifyAll: true
  //   , fields: [
  //     {
  //       name: "class",
  //       type: "literal",
  //       content: "ru.itu.parcus.modules.neurotrainer.modules.mbeegxchg.dto.MbeegCellWeight"
  //     },
  //     {name: "cellId", type: "id"},
  //     {name: "weight", type: "value"}]
  // })
  // , epochsObjectifier = new Objectifier()
  , openVibeClient = new Net.Socket() //3. Create TCP client for openViBE eeg data server
  , tcp2ebmlFeeder = (context, tcpchunk) => {
    if (context.tcpbuffer === undefined) {
      context.tcpbuffer = Buffer.alloc(0);
      context.tcpcursor = 0;
    }
    context.tcpbuffer = Buffer.concat([context.tcpbuffer, tcpchunk]);
    let bufferTailLength = context.tcpbuffer.length - context.tcpcursor;
    while (bufferTailLength) {
      if (!context.expectedEBMLChunkSize && bufferTailLength >= 8) {
        context.expectedEBMLChunkSize = context.tcpbuffer.readUIntLE(context.tcpcursor, 8);//first Uint64LE contains length of ebml data sent by openViBE
        context.tcpcursor += 8;
        bufferTailLength -= 8;
      }
      else if (!context.expectedEBMLChunkSize)
        break;
      if (bufferTailLength >= context.expectedEBMLChunkSize) {
        context.ebmlChunk = Buffer.from(context.tcpbuffer.slice(context.tcpcursor, context.tcpcursor + context.expectedEBMLChunkSize));
        context.tcpcursor += context.expectedEBMLChunkSize;
        bufferTailLength -= context.expectedEBMLChunkSize;
        context.expectedEBMLChunkSize = 0;
      } else
        break;
      context.write(context.ebmlChunk);
    }
    if (!bufferTailLength) {
      context.tcpbuffer = Buffer.alloc(0);
      context.tcpcursor = 0;
    }
  }
  , openVibeJSON = new EBMLReader({
    ebmlSource: openVibeClient.connect(config.signal.port, config.signal.host, () => {})
    , ebmlCallback: tcp2ebmlFeeder
  })
  , samples = new OVReader()
  , stimuli = new Stimuli({ //should pipe simultaneously to the epochs and to the carousel
    signalDuration: config.stimulation.duration
    , pauseDuration: config.stimulation.pause
    , stimuliIdArray: config.stimulation.sequence.stimuli
  })
  , epochs = new Epochs({
    stimuli: stimuli
    , samples: openVibeJSON.pipe(samples)
    , channels: config.signal.channels
    , epochDuration: config.signal.epoch.duration
    , processingSequence: config.signal.dsp.vertical.steps
    , cyclesLimit: config.signal.cycles
  })
  , butterworth4 = new DSProcessor({
    action: Tools.butterworth4Bulanov
  })
  , detrend = new DSProcessor({
    action: Tools.detrend
  })
  , featuresProcessor = new EpochsProcessor({
    epochs: epochs.pipe(butterworth4).pipe(detrend)
    , moving: false
    , depth: config.signal.dsp.horizontal.depth
    , maximumCycleCount: config.decision.cycles
    , stimuliIdArray: config.stimulation.sequence.stimuli
  })
  , classifier = new Classifier({
    method: config.classification.method//TODO it's enough to point method name that is index of config object property that contains needed parameters to invoke method
    , methodParameters: config.classification.methods[config.classification.method]
  })

;

cli.version('0.0.1')
  .description(`Gets features flow and produces stream of verdicts with weights of each stimulus that characterizes the probability of choice.`)
  .usage(`[option]`)
  // .option(`-p --pipe`, `Gets epochs flow from stdin through pipe`)
  // .option(`-i --internal`, `Gets epochs flow from source defined in config.json file`)
  .option(`-j --json`, `Wraps features array into json.`)
  // .option(`-n, --neurotrainer`, `Outputs wrapped into Neuro Trainer specific json`)
  .parse(process.argv)
;

// if (process.argv.length <= 2) {
//   cli.help();
//   return;
// }

// if (cli.pipe) {
//   process.stdin.pipe(epochsObjectifier);
//   if (cli.json) epochsObjectifier.pipe(classifier).pipe(verdictStringifier).pipe(process.stdout);
//   else if (cli.neurotrainer) epochsObjectifier.pipe(classifier).pipe(ntrainerStringifier).pipe(process.stdout);
//   else epochsObjectifier.pipe(classifier).pipe(plainStringifier).pipe(process.stdout);
// } else if (cli.internal) {
  if (cli.json)
    featuresProcessor.pipe(classifier).pipe(verdictStringifier).pipe(process.stdout);
  // else if (cli.neurotrainer) featuresProcessor.pipe(classifier).pipe(ntrainerStringifier).pipe(process.stdout);
  else
    featuresProcessor.pipe(classifier).pipe(plainStringifier).pipe(process.stdout);
// } else {
//   cli.help();
//   return;
// }
