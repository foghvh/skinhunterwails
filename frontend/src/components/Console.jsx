import React, { useEffect, useRef } from 'react';
import { useModLogs } from '../data/hooks';
import { ScrollArea } from '@radix-ui/themes';

const Console = () => {
  const { logs } = useModLogs();
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <ScrollArea 
      ref={scrollRef}
      className="h-[200px] bg-[#0f1729]/80 backdrop-blur-sm border border-[#586a9e] rounded-lg p-2 font-mono text-sm"
      scrollbars="vertical"
    >
      {logs.map((log) => (
        <div
          key={log.id}
          className={`mb-1 ${
            log.type === 'stderr' ? 'text-red-400' : 'text-green-400'
          }`}
        >
          <span className="text-gray-500">[{log.timestamp}]</span>{' '}
          <span>{log.message}</span>
        </div>
      ))}
    </ScrollArea>
  );
};

export default Console;
