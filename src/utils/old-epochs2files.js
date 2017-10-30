"use strict";
const
  Net = require('net')
  , fs = require('fs')
  , cli = require('commander')
  , {EBMLReader, OVReader, Stimuli, DSProcessor, Stringifier, Tools, Sampler, Channels} = require('mbeeg')
  , config = Tools.loadConfiguration(`config.json`)
  , ovStringifier = new Stringifier({
    beginWith: `{`
    , chunkBegin: `"openViBE_Stream":`
    , chunksDelimiter: `, `
    , chunkEnd: `}`
    , endWith: `}\r\n`
    , indentationSpace: 2
  })
  , plainSamplesStringifier = new Stringifier({
    chunkEnd: `\r\n`
  })
  , plainStimsStringifier = new Stringifier({
    chunkEnd: `\r\n`
  })
  , epochsRawStringifier = new Stringifier({
    beginWith: `{"epochs": [`
    , chunksDelimiter: `,`
    , chunkEnd: `\r\n`
    , endWith: `]}\r\n`
    // , stringifyAll: true
    , indentationSpace: 2
  })
  , epochsFilteredStringifier = new Stringifier({
    beginWith: `{"epochs": [`
    , chunksDelimiter: `,`
    , chunkEnd: `\r\n`
    , endWith: `]}\r\n`
    // , stringifyAll: true
    , indentationSpace: 2
  })
  , epochsDetrendedStringifier = new Stringifier({
    beginWith: `{"epochs": [`
    , chunkBegin: ``
    , chunksDelimiter: `,`
    , chunkEnd: `\r\n`
    , endWith: `]}\r\n`
    // , stringifyAll: true
    , indentationSpace: 2
  })
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
  // , samples = new OVReader({})
  , samplesRaw = new OVReader({})
  , samplesFiltered = new OVReader({})
  , samplesDetrended = new OVReader({})
  , sampler = new Sampler({objectMode: false})
  , stimuli = new Stimuli({ //should pipe simultaneously to the dsprocessor and to the carousel
    signalDuration: config.stimulation.duration
    , pauseDuration: config.stimulation.pause
    , stimuliIdArray: config.stimulation.sequence.stimuli
  })
  , epochsRaw = new DSProcessor({
    stimuli: stimuli
    , samples: samplesRaw
    , channels: config.signal.channels
    , epochDuration: config.signal.epoch.duration
    , processingSequence: []//config.signal.dsp.vertical.steps
    , cyclesLimit: config.signal.cycles
  })
  , epochsFiltered = new DSProcessor({
    stimuli: stimuli
    , samples: samplesFiltered
    , channels: config.signal.channels
    , duration: config.signal.epoch.duration
    , processingSequence: config.signal.dsp.vertical.steps.slice(0, 1)
    , cyclesLimit: config.signal.cycles
  })
  , epochsDetrended = new DSProcessor({
    stimuli: stimuli
    , samples: samplesDetrended
    , channels: config.signal.channels
    , duration: config.signal.epoch.duration
    , processingSequence: config.signal.dsp.vertical.steps
    , cyclesLimit: config.signal.cycles
  })
  , channelsMonitor = new Channels({})
;
let
  ovStreamFile = fs.createWriteStream(`./logs/ovStream.json`)
  , samplesFile = fs.createWriteStream(`./logs/samples.json`)
  , stimuliFile = fs.createWriteStream(`./logs/stimuli.json`)
  , epochsRawFile = fs.createWriteStream(`./logs/epochsRaw.json`)
  , epochsFilteredFile = fs.createWriteStream(`./logs/epochsFiltered.json`)
  , epochsDetrendedFile = fs.createWriteStream(`./logs/epochsDetrended.json`)
;

cli.version('0.0.1')
  .description(`Epochs generator. Gets stimuli & samples flows and produces stream of json epoch objects.`)
  .usage(`<option>`)
  .option(`-c, --channels`, `Outputs activity by channels`)
  .option(`-e --epochs`, `Outputs json epoch-objects`)
  // .option(`-p --pipe`, `Gets stimuli flow from stdin through pipe`)
  .parse(process.argv)
;

// if (process.argv.length <= 2) cli.help();
// const
// ;
openVibeJSON.pipe(ovStringifier).pipe(ovStreamFile);
samplesRaw.pipe(sampler).pipe(plainSamplesStringifier).pipe(samplesFile);
// stimuli.pipe(plainStimsStringifier).pipe(stimuliFile);
epochsRaw.pipe(epochsRawStringifier).pipe(epochsRawFile);
// epochsFiltered.pipe(epochsFilteredStringifier).pipe(epochsFilteredFile);
// epochsDetrended.pipe(epochsDetrendedStringifier).pipe(epochsDetrendedFile);

// epochsFiltered.pipe(channelsMonitor).pipe(process.stdout);
