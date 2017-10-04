"use strict";

const
  Net = require('net')
  , cli = require('commander')
  , {EBMLReader, OVReader, DSProcessor, Stimuli, Stringifier, Objectifier, Tools, Channels} = require('mbeeg')
  , config = Tools.loadConfiguration(`config.json`)
  , plainStringifier = new Stringifier({
    chunkEnd: `\n\r`
  })
  , epochsStringifier = new Stringifier({
    beginWith: `{"epochs": [\n`
    , chunkBegin: `\n\r`
    , chunksDelimiter: `,`
    , chunkEnd: `\n\r`
    , endWith: `]}`
    // , indentationSpace: 2
  })
  , stimuliObjectifier = new Objectifier()
  , openVibeClient = new Net.Socket() //3. Create TCP client for openViBE eeg data server
  , tcpFeeder = (context, tcpchunk) => {
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
      else if(!context.expectedEBMLChunkSize)
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
    , ebmlCallback: tcpFeeder
  })
  , samples = new OVReader({
    ovStream: openVibeJSON
    //TODO get sampleRate from ovSream // , signalDescriptor: signalGlobalsDescriptor
  })
  , stimuli = new Stimuli({ //should pipe simultaneously to the dsprocessor and to the carousel
    signalDuration: config.stimulation.duration
    , pauseDuration: config.stimulation.pause
    , stimuliArray: config.stimulation.sequence.stimuli
  })
  , channelsMonitor = new Channels({
    // keys: [20],
    // channels: [1] //, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  })
;
let epochs = {};

cli.version('0.0.1')
  .description(`Epochs generator. Gets stimuli & samples flows and produces stream of json epoch objects.`)
  .usage(`<option>`)
  .option(`-c, --channels`, `Outputs activity by channels`)
  .option(`-e --epochs`, `Outputs json epoch-objects`)
  // .option(`-p --pipe`, `Gets stimuli flow from stdin through pipe`)
  .parse(process.argv)
;

if (cli.pipe) {
  process.stdin.pipe(stimuliObjectifier);
  epochs = new DSProcessor({
    stimuli: stimuliObjectifier
    , samples: samples
    // , cyclesLimit: 1
    // , samplingRate: signalGlobalsDescriptor.samplingRate //TODO solve problem with passing sampling rate to DSProcessor
    , channels: config.signal.channels
    , processingSteps: config.signal.dsp.vertical.steps
  })
  ;
} else {
  epochs = new DSProcessor({
    stimuli: stimuli
    , samples: samples
    // , cyclesLimit: 1
    // , samplingRate: signalGlobalsDescriptor.samplingRate //TODO solve problem with passing sampling rate to DSProcessor
    , channels: config.signal.channels
    , processingSteps: config.signal.dspsteps
  })
  ;
}

if (process.argv.length <= 2) cli.help();
if (cli.channels) epochs.pipe(channelsMonitor).pipe(process.stdout);
if (cli.epochs) epochs.pipe(epochsStringifier).pipe(process.stdout);

