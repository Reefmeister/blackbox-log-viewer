"use strict";

function FlightLogIndex(logData) {
    //Private:
    var 
        that = this,
        logBeginOffsets = false,
        logCount = false,
        intraframeDirectories = false;
        
    function buildLogOffsetsIndex() {
        var 
            stream = new ArrayDataStream(logData), 
            i, logStart;
        
        logBeginOffsets = [];
    
        for (i = 0; ; i++) {
            logStart = stream.nextOffsetOf(FlightLogParser.prototype.FLIGHT_LOG_START_MARKER);
    
            if (logStart == -1) {
                //No more logs found in the file
                logBeginOffsets.push(stream.end);
                break; 
            }
    
            logBeginOffsets.push(logStart);
            
            //Restart the search after this header
            stream.pos = logStart + FlightLogParser.prototype.FLIGHT_LOG_START_MARKER.length;
        }
    }
    
    function buildIntraframeDirectories() {
        var 
            parser = new FlightLogParser(logData, that);
        
        intraframeDirectories = [];

        for (var i = 0; i < that.getLogCount(); i++) {
            var 
                intraIndex = {
                    times: [],
                    offsets: [],
                    avgThrottle: [],
                    initialIMU: [],
                    hasEvent: [],
                    minTime: false,
                    maxTime: false
                },
                
                imu = new IMU(),
                gyroData, accSmooth, magADC,
                
                iframeCount = 0,
                motorFields = [],
                fieldNames,
                matches,
                throttleTotal,
                eventInThisChunk = null,
                sysConfig;
            
            parser.parseHeader(logBeginOffsets[i], logBeginOffsets[i + 1]);

            sysConfig = parser.sysConfig;
            
            gyroData = [parser.mainFieldNameToIndex["gyroData[0]"], parser.mainFieldNameToIndex["gyroData[1]"], parser.mainFieldNameToIndex["gyroData[2]"]];
            accSmooth = [parser.mainFieldNameToIndex["accSmooth[0]"], parser.mainFieldNameToIndex["accSmooth[1]"], parser.mainFieldNameToIndex["accSmooth[2]"]];
            magADC = [parser.mainFieldNameToIndex["magADC[0]"], parser.mainFieldNameToIndex["magADC[1]"], parser.mainFieldNameToIndex["magADC[2]"]];
            
            // Identify motor fields so they can be used to show the activity summary bar
            for (var j = 0; j < 8; j++) {
                if (parser.mainFieldNameToIndex["motor[" + j + "]"] !== undefined) {
                    motorFields.push(parser.mainFieldNameToIndex["motor[" + j + "]"]);
                }
            }
            
            // Do we have mag fields? If not mark that data as absent
            if (magADC[0] === undefined) {
                magADC = false;
            }
            
            parser.onFrameReady = function(frameValid, frame, frameType, frameOffset, frameSize) {
                if (frameValid) {
                    if (frameType == 'P' || frameType == 'I') {
                        var 
                            frameTime = frame[FlightLogParser.prototype.FLIGHT_LOG_FIELD_INDEX_TIME];
                        
                        if (intraIndex.minTime === false) {
                            intraIndex.minTime = frameTime;
                        }
                        
                        if (intraIndex.maxTime === false || frameTime > intraIndex.maxTime) {
                            intraIndex.maxTime = frameTime;
                        }
                        
                        if (frameType == 'I') {
                            // Start a new chunk on every 4th I-frame
                            if (iframeCount % 4 == 0) {
                                // Log the beginning of the new chunk
                                intraIndex.times.push(frameTime);
                                intraIndex.offsets.push(frameOffset);
                                
                                if (motorFields.length) {
                                    throttleTotal = 0;
                                    for (var j = 0; j < motorFields.length; j++)
                                        throttleTotal += frame[motorFields[j]];
                                    
                                    intraIndex.avgThrottle.push(Math.round(throttleTotal / motorFields.length));
                                }
                                
                                intraIndex.initialIMU.push(new IMU(imu));
                            }
                            
                            iframeCount++;
                        }
                        
                        imu.updateEstimatedAttitude(
                            [frame[gyroData[0]], frame[gyroData[1]], frame[gyroData[2]]],
                            [frame[accSmooth[0]], frame[accSmooth[1]], frame[accSmooth[2]]],
                            frame[FlightLogParser.prototype.FLIGHT_LOG_FIELD_INDEX_TIME], 
                            sysConfig.acc_1G, 
                            sysConfig.gyroScale, 
                            magADC ? [frame[magADC[0]], frame[magADC[1]], frame[magADC[2]]] : false
                        );
                    } else if (frameType == 'E') {
                        // Mark that there was an event inside the current chunk
                        if (intraIndex.times.length > 0) {
                            intraIndex.hasEvent[intraIndex.times.length - 1] = true;
                        }
                    }
                }
            };
            
            parser.parseLogData(false);
        
            intraframeDirectories.push(intraIndex);
        }
    }
    
    //Public: 
    this.loadFromJSON = function(json) {
        
    };
    
    this.saveToJSON = function() {
        var 
            intraframeDirectories = this.getIntraframeDirectories(),
            i, j, 
            resultIndexes = new Array(intraframeDirectories.length);
        
        for (i = 0; i < intraframeDirectories.length; i++) {
            var 
                lastTime, lastLastTime, 
                lastOffset, lastLastOffset,
                lastThrottle,
                
                sourceIndex = intraframeDirectories[i],
                
                resultIndex = {
                    times: new Array(sourceIndex.times.length), 
                    offsets: new Array(sourceIndex.offsets.length),
                    minTime: sourceIndex.minTime,
                    maxTime: sourceIndex.maxTime,
                    avgThrottle: new Array(sourceIndex.avgThrottle.length)
                };
            
            if (sourceIndex.times.length > 0) {
                resultIndex.times[0] = sourceIndex.times[0];
                resultIndex.offsets[0] = sourceIndex.offsets[0];
                
                lastLastTime = lastTime = sourceIndex.times[0];
                lastLastOffset = lastOffset = sourceIndex.offsets[0];
                
                for (j = 1; j < sourceIndex.times.length; j++) {
                    resultIndex.times[j] = sourceIndex.times[j] - 2 * lastTime + lastLastTime;
                    resultIndex.offsets[j] = sourceIndex.offsets[j] - 2 * lastOffset + lastLastOffset;
                    
                    lastLastTime = lastTime;
                    lastTime = sourceIndex.times[j];
    
                    lastLastOffset = lastOffset;
                    lastOffset = sourceIndex.offsets[j];
                }
            }
            
            if (sourceIndex.avgThrottle.length > 0) {
                for (j = 0; j < sourceIndex.avgThrottle.length; j++) {
                    resultIndex.avgThrottle[j] = sourceIndex.avgThrottle[j] - 1000;
                }
            }
            
            resultIndexes[i] = resultIndex;
        }
        
        return JSON.stringify(resultIndexes);
    };  
    
    this.getLogBeginOffset = function(index) {
        if (!logBeginOffsets)
            buildLogOffsetsIndex();
        
        return logBeginOffsets[index];
    };
    
    this.getLogCount = function() {
        if (!logBeginOffsets)
            buildLogOffsetsIndex();

        return logBeginOffsets.length - 1;
    };
    
    this.getIntraframeDirectories = function() {
        if (!intraframeDirectories)
            buildIntraframeDirectories();
        
        return intraframeDirectories;
    };
    
    this.getIntraframeDirectory = function(logIndex) {
        return this.getIntraframeDirectories()[logIndex];
    };
}