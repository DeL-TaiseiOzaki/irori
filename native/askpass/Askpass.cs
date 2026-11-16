// irori-askpass.exe: what `ssh` runs on Windows to ask the person something while it
// signs in (ADR 061, amended; src/host/ssh-askpass.ts has the other half).
//
// Win32-OpenSSH starts SSH_ASKPASS as `"<this program>" <question>`, the question
// written after it as it is, unquoted. So the question is taken from the raw command
// line and never from parsed arguments, and this is a program of its own and not a
// script: Windows hands a script to cmd.exe, where a host's words would be commands.
// Nothing in the question is treated as an option, a path or a command.
//
// It hands the question to irori through a named pipe and prints the answer:
//   to irori: a length in four bytes, least significant first, then that many bytes
//             of UTF-8: the session, a line break, ssh's hint, a line break, the question;
//   from irori: one byte, 1 for an answer and 0 for none, then a length as above and
//             the answer in UTF-8.
// No answer, or anything going wrong, is exit code 1 with nothing printed.
//
// Built by scripts/build-askpass.mjs with the C# compiler every Windows has
// (.NET Framework 4), so it keeps to what that compiler knows.
using System;
using System.IO;
using System.IO.Pipes;
using System.Text;

internal static class Askpass
{
    private const int LongestAnswer = 64 * 1024;

    /// <summary>What follows the program's own name on the command line, as it was written.</summary>
    internal static string Question(string commandLine)
    {
        int at = 0;
        if (commandLine.Length > 0 && commandLine[0] == '"')
        {
            at = commandLine.IndexOf('"', 1);
            at = at < 0 ? commandLine.Length : at + 1;
        }
        else
        {
            while (at < commandLine.Length && commandLine[at] != ' ' && commandLine[at] != '\t') at++;
        }
        while (at < commandLine.Length && (commandLine[at] == ' ' || commandLine[at] == '\t')) at++;
        return commandLine.Substring(at);
    }

    private static void ReadAll(Stream stream, byte[] buffer, int count)
    {
        int read = 0;
        while (read < count)
        {
            int got = stream.Read(buffer, read, count - read);
            if (got <= 0) throw new EndOfStreamException();
            read += got;
        }
    }

    private static int Main()
    {
        try
        {
            string address = Environment.GetEnvironmentVariable("IRORI_SSH_ASKPASS");
            string session = Environment.GetEnvironmentVariable("IRORI_SSH_ASKPASS_SESSION");
            string hint = Environment.GetEnvironmentVariable("SSH_ASKPASS_PROMPT") ?? "";
            const string pipes = @"\\.\pipe\";
            if (string.IsNullOrEmpty(address) || string.IsNullOrEmpty(session)) return 1;
            if (!address.StartsWith(pipes, StringComparison.OrdinalIgnoreCase)) return 1;

            byte[] body = new UTF8Encoding(false).GetBytes(
                session + "\n" + hint + "\n" + Question(Environment.CommandLine));
            using (var pipe = new NamedPipeClientStream(
                ".", address.Substring(pipes.Length), PipeDirection.InOut, PipeOptions.None))
            {
                pipe.Connect(10000);
                pipe.Write(BitConverter.GetBytes((uint)body.Length), 0, 4);
                pipe.Write(body, 0, body.Length);
                pipe.Flush();

                byte[] head = new byte[5];
                ReadAll(pipe, head, 5);
                if (head[0] != 1) return 1;
                uint length = BitConverter.ToUInt32(head, 1);
                if (length > LongestAnswer) return 1;
                byte[] answer = new byte[length + 1];
                ReadAll(pipe, answer, (int)length);
                answer[length] = (byte)'\n';
                using (Stream output = Console.OpenStandardOutput())
                {
                    output.Write(answer, 0, answer.Length);
                    output.Flush();
                }
                Array.Clear(answer, 0, answer.Length);
                return 0;
            }
        }
        catch (Exception)
        {
            return 1;
        }
    }
}
